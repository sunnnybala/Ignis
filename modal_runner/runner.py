import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import modal

# =========
# Modal app
# =========

APP_NAME = "ignis-experiment-runner"

# Shared dataset cache across all users/jobs (MVP)
DATASET_VOLUME_NAME = os.environ.get("IGNIS_DATASET_VOLUME_NAME", "ignis-datasets-cache")
DATASET_MOUNT = "/vol"
DATASET_ROOT = f"{DATASET_MOUNT}/datasets"

# Kaggle credentials should be configured as a Modal Secret (MVP: global creds)
# Recommended secret env vars:
# - KAGGLE_USERNAME
# - KAGGLE_KEY
KAGGLE_SECRET_NAME = os.environ.get("IGNIS_KAGGLE_SECRET_NAME", "ignis-kaggle")

# Internal safety caps (not part of the Node->Modal payload, per MVP requirements)
MAX_LOG_CHARS = 200_000

app = modal.App(APP_NAME)

image = (
    modal.Image.debian_slim(python_version="3.11")
    # Install ALL runtime deps from modal_runner/requirements.txt so the experiment environment
    # matches the pinned list in repo. To add packages, edit requirements.txt and redeploy.
    .pip_install_from_requirements("modal_runner/requirements.txt")
)

dataset_vol = modal.Volume.from_name(DATASET_VOLUME_NAME, create_if_missing=True)
kaggle_secret = modal.Secret.from_name(KAGGLE_SECRET_NAME)


def _now_ms() -> int:
    return int(time.time() * 1000)


def _log(event: str, **fields: Any) -> None:
    # Keep logs structured and consistent for grepping.
    base = {"event": event, "ts": _now_ms(), **fields}
    print("[modal.runner]", json.dumps(base, ensure_ascii=False))


def _truncate(s: str, n: int = MAX_LOG_CHARS) -> str:
    if s is None:
        return ""
    if len(s) <= n:
        return s
    half = n // 2
    return s[:half] + "\n...\n" + s[-half:]


def _safe_dataset_key(s: str) -> str:
    # Convert "owner/dataset" -> "kaggle__owner__dataset" (safe path component)
    s = s.strip()
    s = s.replace("/", "__")
    s = re.sub(r"[^a-zA-Z0-9._-]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return f"kaggle__{s}"


def _ensure_kaggle_auth(traceId: str, jobId: str, projectId: str) -> None:
    # Kaggle library uses env vars KAGGLE_USERNAME/KAGGLE_KEY or ~/.kaggle/kaggle.json
    # We'll support env vars as the simplest MVP.
    u = os.environ.get("KAGGLE_USERNAME", "").strip()
    k = os.environ.get("KAGGLE_KEY", "").strip()
    if not u or not k:
        raise RuntimeError("Kaggle credentials missing. Set KAGGLE_USERNAME and KAGGLE_KEY in Modal Secret.")
    # Avoid logging secrets; just confirm presence.
    _log("kaggle.auth.ok", traceId=traceId, jobId=jobId, projectId=projectId)


def _parse_dataset_json(dataset_json_raw: str) -> Tuple[str, bool, Optional[str]]:
    """
    Returns (kaggle_dataset_slug, unzip, subdir)
    """
    obj = json.loads(dataset_json_raw)
    if not isinstance(obj, dict):
        raise ValueError("datasetJson must be an object")
    if obj.get("source") != "kaggle":
        raise ValueError(f"Unsupported source: {obj.get('source')}")
    kaggle = obj.get("kaggle")
    if not isinstance(kaggle, dict):
        raise ValueError("kaggle must be an object")
    slug = str(kaggle.get("dataset") or "").strip()
    if not slug or "/" not in slug:
        raise ValueError('kaggle.dataset must look like "owner/dataset"')
    unzip = kaggle.get("unzip", True)
    if not isinstance(unzip, bool):
        raise ValueError("kaggle.unzip must be a boolean")
    layout = obj.get("layout")
    subdir: Optional[str] = None
    if isinstance(layout, dict):
        sd = layout.get("subdir")
        if isinstance(sd, str) and sd.strip():
            subdir = sd.strip()
    return slug, unzip, subdir


def _download_dataset_if_needed(
    traceId: str,
    jobId: str,
    projectId: str,
    kaggle_slug: str,
    unzip: bool,
) -> str:
    Path(DATASET_ROOT).mkdir(parents=True, exist_ok=True)
    key = _safe_dataset_key(kaggle_slug)
    dataset_dir = Path(DATASET_ROOT) / key
    dataset_dir.mkdir(parents=True, exist_ok=True)

    ready = dataset_dir / ".ready"
    downloading = dataset_dir / ".downloading"

    if ready.exists():
        _log("dataset.cache.hit", traceId=traceId, jobId=jobId, projectId=projectId, key=key, dir=str(dataset_dir))
        return str(dataset_dir)

    # Best-effort lock: if someone else is downloading, wait a bit then re-check.
    if downloading.exists():
        _log("dataset.cache.wait", traceId=traceId, jobId=jobId, projectId=projectId, key=key)
        for _ in range(30):  # ~30s
            if ready.exists():
                _log("dataset.cache.hit.after_wait", traceId=traceId, jobId=jobId, projectId=projectId, key=key)
                return str(dataset_dir)
            time.sleep(1)

    _log("dataset.cache.miss", traceId=traceId, jobId=jobId, projectId=projectId, key=key, dir=str(dataset_dir))

    try:
        downloading.write_text(json.dumps({"jobId": jobId, "at": _now_ms()}), encoding="utf-8")

        # Clear old files except markers (MVP: no stale data logic; but avoid partial trash on retries)
        for p in dataset_dir.iterdir():
            if p.name in [".downloading", ".ready"]:
                continue
            if p.is_dir():
                shutil.rmtree(p, ignore_errors=True)
            else:
                try:
                    p.unlink()
                except OSError:
                    pass

        cmd = ["kaggle", "datasets", "download", "-d", kaggle_slug, "-p", str(dataset_dir)]
        if unzip:
            cmd.append("--unzip")
        _log("kaggle.download.start", traceId=traceId, jobId=jobId, projectId=projectId, slug=kaggle_slug, unzip=unzip)
        t0 = time.time()
        proc = subprocess.run(cmd, capture_output=True, text=True)
        ms = int((time.time() - t0) * 1000)
        _log(
            "kaggle.download.end",
            traceId=traceId,
            jobId=jobId,
            projectId=projectId,
            slug=kaggle_slug,
            ms=ms,
            code=proc.returncode,
            stdoutLen=proc.stdout or "",
            stderrLen=proc.stderr or "",
        )
        if proc.returncode != 0:
            raise RuntimeError(_truncate((proc.stderr or proc.stdout or "Kaggle download failed").strip(), 8000))

        ready.write_text(json.dumps({"slug": kaggle_slug, "unzip": unzip, "at": _now_ms()}), encoding="utf-8")
        dataset_vol.commit()
        return str(dataset_dir)
    finally:
        try:
            if downloading.exists() and ready.exists():
                downloading.unlink()
        except OSError:
            pass


def _guess_mime(p: Path) -> str:
    if p.suffix.lower() == ".png":
        return "image/png"
    if p.suffix.lower() == ".csv":
        return "text/csv"
    return "application/octet-stream"


def _presign_uploads(
    traceId: str,
    jobId: str,
    projectId: str,
    presign_url: str,
    job_token: str,
    artifacts: List[Path],
) -> List[Dict[str, Any]]:
    import requests

    items = []
    for p in artifacts:
        size = p.stat().st_size
        items.append({"fileName": p.name, "mimeType": _guess_mime(p), "sizeBytes": size})

    _log("presign.request.start", traceId=traceId, jobId=jobId, projectId=projectId, count=len(items))
    resp = requests.post(presign_url, json={"token": job_token, "items": items}, timeout=60)
    if not resp.ok:
        raise RuntimeError(f"Presign failed: HTTP {resp.status_code} — {resp.text[:2000]}")
    data = resp.json()
    uploads = data.get("uploads") if isinstance(data, dict) else None
    if not isinstance(uploads, list):
        raise RuntimeError("Presign response missing uploads[]")
    _log("presign.request.end", traceId=traceId, jobId=jobId, projectId=projectId, count=len(uploads))
    return uploads  # [{ key, signedUrl, token, fileName, mimeType }]


def _upload_to_supabase_signed_url(
    signed_url: str,
    token: str,
    content_type: str,
    data: bytes,
) -> None:
    import requests

    # Supabase signed upload URLs use an upload token. Exact semantics can vary; we try PUT first,
    # then fall back to POST if needed.
    headers = {"Content-Type": content_type, "Authorization": f"Bearer {token}"}

    r = requests.put(signed_url, headers=headers, data=data, timeout=120)
    if r.ok:
        return

    # Fallback attempt
    r2 = requests.post(signed_url, headers=headers, data=data, timeout=120)
    if r2.ok:
        return

    raise RuntimeError(f"Upload failed: PUT {r.status_code}, POST {r2.status_code} — {r2.text[:2000]}")


def _upload_artifacts(
    traceId: str,
    jobId: str,
    runId: str,
    projectId: str,
    presign_url: str,
    job_token: str,
    artifacts: List[Path],
) -> List[Dict[str, Any]]:
    uploads = _presign_uploads(traceId, jobId, projectId, presign_url, job_token, artifacts)
    by_name = {u.get("fileName"): u for u in uploads if isinstance(u, dict)}
    out: List[Dict[str, Any]] = []
    for p in artifacts:
        try:
            u = by_name.get(p.name)
            if not u:
                _log("artifact.upload.skip", traceId=traceId, jobId=jobId, projectId=projectId, name=p.name, reason="no presign entry")
                continue
            signed_url = str(u.get("signedUrl") or "")
            up_token = str(u.get("token") or "")
            key = str(u.get("key") or "")
            if not signed_url or not up_token or not key:
                _log("artifact.upload.skip", traceId=traceId, jobId=jobId, projectId=projectId, name=p.name, reason="missing signedUrl/token/key")
                continue

            data = p.read_bytes()
            mime = _guess_mime(p)
            _log("artifact.upload.start", traceId=traceId, jobId=jobId, projectId=projectId, name=p.name, bytes=len(data))
            _upload_to_supabase_signed_url(signed_url, up_token, mime, data)
            _log("artifact.upload.end", traceId=traceId, jobId=jobId, projectId=projectId, name=p.name)

            out.append(
                {
                    # IMPORTANT: Node persists artifacts into the DB "virtual filesystem" under Results/<runId>/...
                    # jobId remains the stable identifier for callbacks/auth; runId is only the results directory name.
                    "path": f"Results/{runId}/{p.name}",
                    "storageKey": key,
                    "mimeType": mime,
                    "sizeBytes": len(data),
                }
            )
        except Exception as e:
            # Non-fatal: continue uploading other artifacts and report warning via resultsText.
            _log(
                "artifact.upload.error",
                traceId=traceId,
                jobId=jobId,
                projectId=projectId,
                name=p.name,
                message=_truncate(f"{type(e).__name__}: {e}", 2000),
            )
    return out


def _call_complete(
    traceId: str,
    jobId: str,
    projectId: str,
    complete_url: str,
    job_token: str,
    exit_code: int,
    results_text: str,
    artifacts_meta: List[Dict[str, Any]],
) -> None:
    import requests

    _log(
        "complete.callback.start",
        traceId=traceId,
        jobId=jobId,
        projectId=projectId,
        exitCode=exit_code,
        resultsLen=len(results_text),
        artifactsCount=len(artifacts_meta),
    )
    resp = requests.post(
        complete_url,
        json={
            "token": job_token,
            "traceId": traceId,
            "exitCode": exit_code,
            "resultsText": results_text,
            "artifacts": artifacts_meta,
        },
        timeout=60,
    )
    if not resp.ok:
        raise RuntimeError(f"Complete callback failed: HTTP {resp.status_code} — {resp.text[:2000]}")
    _log("complete.callback.end", traceId=traceId, jobId=jobId, projectId=projectId)


@app.function(
    image=image,
    secrets=[kaggle_secret],
    volumes={DATASET_MOUNT: dataset_vol},
    timeout=60 * 60,  # 1 hour MVP default; can be tuned later
)
@modal.fastapi_endpoint(method="POST")
def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    POST /run
    Expects payload from Node:
      { traceId, jobId, runId, projectId, jobToken, experimentPy, requirementsTxt, datasetJson, presignUrl, completeUrl }
    """
    # Dynamic import so local editors without FastAPI installed don't warn/error;
    # Modal runtime image includes FastAPI (required for @fastapi_endpoint).
    import importlib
    HTTPException = importlib.import_module("fastapi").HTTPException

    traceId = str(payload.get("traceId") or "").strip() or str(_now_ms())
    jobId = str(payload.get("jobId") or "").strip()
    runId = str(payload.get("runId") or "").strip()
    projectId = str(payload.get("projectId") or "").strip()

    _log("run.received", traceId=traceId, jobId=jobId, runId=runId, projectId=projectId)

    # Pull required fields
    jobToken = str(payload.get("jobToken") or "").strip()
    experimentPy = str(payload.get("experimentPy") or "")
    requirementsTxt = str(payload.get("requirementsTxt") or "")
    datasetJson = str(payload.get("datasetJson") or "")
    presignUrl = str(payload.get("presignUrl") or "").strip()
    completeUrl = str(payload.get("completeUrl") or "").strip()

    # Fast validation only (ack quickly). Long work happens in execute_job().
    if not jobId or not projectId or not jobToken:
        raise HTTPException(status_code=400, detail="Missing required identifiers (jobId/projectId/jobToken)")
    if not runId:
        raise HTTPException(status_code=400, detail="Missing required identifier (runId)")
    if not experimentPy.strip():
        raise HTTPException(status_code=400, detail="experimentPy is empty")
    if not datasetJson.strip():
        raise HTTPException(status_code=400, detail="datasetJson is empty")
    if not presignUrl or not completeUrl:
        raise HTTPException(status_code=400, detail="Missing presignUrl/completeUrl")

    # Parse dataset config as part of validation (do not download yet)
    try:
        kaggle_slug, unzip, subdir = _parse_dataset_json(datasetJson)
    except Exception as e:
        _log("run.validation.error", traceId=traceId, jobId=jobId, projectId=projectId, message=_truncate(f"{type(e).__name__}: {e}", 2000))
        raise HTTPException(status_code=400, detail=str(e))

    _log(
        "run.validation.ok",
        traceId=traceId,
        jobId=jobId,
        runId=runId,
        projectId=projectId,
        source="kaggle",
        slug=kaggle_slug,
        unzip=unzip,
        subdir=subdir,
    )

    # Spawn long-running work asynchronously and return an ack immediately.
    fc = execute_job.spawn(
        traceId,
        jobId,
        runId,
        projectId,
        jobToken,
        experimentPy,
        requirementsTxt,
        datasetJson,
        presignUrl,
        completeUrl,
    )
    _log("run.ack", traceId=traceId, jobId=jobId, projectId=projectId, function_call_id=str(getattr(fc, "object_id", "")))
    return {"ok": True, "jobId": jobId, "traceId": traceId, "queued": True}


@app.function(
    image=image,
    secrets=[kaggle_secret],
    volumes={DATASET_MOUNT: dataset_vol},
    timeout=60 * 60,  # long work timeout
)
def execute_job(
    traceId: str,
    jobId: str,
    runId: str,
    projectId: str,
    jobToken: str,
    experimentPy: str,
    requirementsTxt: str,
    datasetJson: str,
    presignUrl: str,
    completeUrl: str,
) -> None:
    """
    Long-running worker:
    - dataset download/cache
    - experiment run
    - artifact upload
    - callback to Node /complete
    """
    _log("execute.start", traceId=traceId, jobId=jobId, runId=runId, projectId=projectId)

    exit_code = 1
    results_text = ""
    artifacts_meta: List[Dict[str, Any]] = []

    try:
        kaggle_slug, unzip, subdir = _parse_dataset_json(datasetJson)
        _log(
            "dataset.parsed",
            traceId=traceId,
            jobId=jobId,
            runId=runId,
            projectId=projectId,
            source="kaggle",
            slug=kaggle_slug,
            unzip=unzip,
            subdir=subdir,
        )

        _ensure_kaggle_auth(traceId, jobId, projectId)
        dataset_dir = _download_dataset_if_needed(traceId, jobId, projectId, kaggle_slug, unzip)
        data_dir = dataset_dir
        if subdir:
            data_dir = str(Path(dataset_dir) / subdir)

        # Run experiment + upload artifacts BEFORE the temp directory is deleted.
        with tempfile.TemporaryDirectory(prefix=f"ignis-{jobId}-") as td:
            workdir = Path(td)
            (workdir / "experiment.py").write_text(experimentPy, encoding="utf-8")

            # Install per-project dependencies at runtime (from Experimentation/requirements.txt in VFS).
            # requirementsTxt is expected to be ONLY package names (one per line), no versions/urls/flags.
            req_raw = (requirementsTxt or "").strip()
            if req_raw:
                # Sanitize: strip comments/empties; reject suspicious lines.
                lines: List[str] = []
                for ln in req_raw.splitlines():
                    s = ln.strip()
                    if not s or s.startswith("#"):
                        continue
                    # Reject anything that isn't "just a package name"
                    bad = any(
                        s.startswith(pfx)
                        for pfx in ["-r", "--", "-e", "git+", "http://", "https://", "file:"]
                    )
                    bad = bad or ("==" in s) or (">=" in s) or ("<=" in s) or ("~=" in s) or ("@" in s) or ("/" in s)
                    if bad:
                        raise RuntimeError(
                            f"Invalid requirements line (must be a bare package name): {s!r}"
                        )
                    lines.append(s)

                if lines:
                    (workdir / "requirements.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
                    _log(
                        "pip.install.start",
                        traceId=traceId,
                        jobId=jobId,
                        projectId=projectId,
                        count=len(lines),
                        pkgs=lines[:30],
                    )
                    t1 = time.time()
                    pip_proc = subprocess.run(
                        ["python", "-m", "pip", "install", "--no-cache-dir", "-r", "requirements.txt"],
                        cwd=str(workdir),
                        capture_output=True,
                        text=True,
                    )
                    ms_pip = int((time.time() - t1) * 1000)
                    _log(
                        "pip.install.end",
                        traceId=traceId,
                        jobId=jobId,
                        projectId=projectId,
                        ms=ms_pip,
                        code=pip_proc.returncode,
                    )
                    if pip_proc.returncode != 0:
                        raise RuntimeError(
                            _truncate(
                                "pip install failed:\n\n=== STDOUT ===\n"
                                + (pip_proc.stdout or "")
                                + "\n\n=== STDERR ===\n"
                                + (pip_proc.stderr or ""),
                                8000,
                            )
                        )

            _log("experiment.exec.start", traceId=traceId, jobId=jobId, projectId=projectId, data_dir=data_dir)
            t0 = time.time()

            # Run with real-time output streaming to Modal logs
            proc = subprocess.Popen(
                ["python", "-u", "experiment.py", "--data_dir", data_dir],  # -u for unbuffered output
                cwd=str(workdir),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )

            # Collect output while also printing to Modal logs
            out_lines: List[str] = []
            err_lines: List[str] = []

            import threading

            def read_stdout():
                for line in proc.stdout:
                    print(f"[experiment.stdout] {line}", end="")
                    out_lines.append(line)

            def read_stderr():
                for line in proc.stderr:
                    print(f"[experiment.stderr] {line}", end="")
                    err_lines.append(line)

            stdout_thread = threading.Thread(target=read_stdout)
            stderr_thread = threading.Thread(target=read_stderr)
            stdout_thread.start()
            stderr_thread.start()

            proc.wait()
            stdout_thread.join()
            stderr_thread.join()

            ms = int((time.time() - t0) * 1000)
            exit_code = proc.returncode
            _log("experiment.exec.end", traceId=traceId, jobId=jobId, projectId=projectId, exitCode=exit_code, ms=ms)

            out = "".join(out_lines)
            err = "".join(err_lines)
            results_text = f"Exit code: {exit_code}\n\n=== STDOUT ===\n{out}\n\n=== STDERR ===\n{err}\n"
            results_text = _truncate(results_text, MAX_LOG_CHARS)

            # Collect artifacts from workdir (MVP: only immediate files in workdir)
            artifacts: List[Path] = []
            for p in workdir.iterdir():
                if not p.is_file():
                    continue
                if p.name == "experiment.py":
                    continue
                ext = p.suffix.lower()
                if ext in [".png", ".csv"]:
                    artifacts.append(p)

            _log(
                "artifact.scan",
                traceId=traceId,
                jobId=jobId,
                runId=runId,
                projectId=projectId,
                count=len(artifacts),
                names=[p.name for p in artifacts][:50],
            )

            # Upload artifacts (png/csv). Non-fatal: failures append a warning to results_text.
            if artifacts:
                try:
                    artifacts_meta = _upload_artifacts(traceId, jobId, runId, projectId, presignUrl, jobToken, artifacts)
                except Exception as e:
                    msg = f"Artifact upload failed (non-fatal): {type(e).__name__}: {e}"
                    _log("artifact.upload.failed", traceId=traceId, jobId=jobId, projectId=projectId, message=_truncate(msg, 2000))
                    results_text = _truncate(results_text + "\n\n" + msg + "\n", MAX_LOG_CHARS)

    except Exception as e:
        msg = f"Runner error: {type(e).__name__}: {str(e)}"
        _log("execute.error", traceId=traceId, jobId=jobId, runId=runId, projectId=projectId, message=_truncate(msg, 4000))
        results_text = _truncate(results_text + "\n\n" + msg + "\n", MAX_LOG_CHARS)
        exit_code = 1
    finally:
        try:
            _call_complete(traceId, jobId, projectId, completeUrl, jobToken, exit_code, results_text, artifacts_meta)
        except Exception as e:
            _log(
                "complete.callback.failed",
                traceId=traceId,
                jobId=jobId,
                projectId=projectId,
                message=_truncate(f"{type(e).__name__}: {e}", 4000),
            )

    _log("execute.end", traceId=traceId, jobId=jobId, runId=runId, projectId=projectId, exitCode=exit_code, artifactsCount=len(artifacts_meta))


# =====================
# Synchronous execution
# =====================


def _execute_experiment_sync(
    traceId: str,
    experimentPy: str,
    requirementsTxt: str,
    kaggle_slug: str,
    unzip: bool,
    subdir: Optional[str],
) -> Dict[str, Any]:
    """
    Shared sync execution logic - returns results directly.
    No artifact upload or callback (caller handles persistence).
    Used by run_sync endpoint for agent-based iteration.
    """
    exit_code = 1
    stdout = ""
    stderr = ""
    artifacts: List[Dict[str, str]] = []

    try:
        _ensure_kaggle_auth(traceId, "sync", "sync")
        dataset_dir = _download_dataset_if_needed(traceId, "sync", "sync", kaggle_slug, unzip)
        data_dir = dataset_dir
        if subdir:
            data_dir = str(Path(dataset_dir) / subdir)

        with tempfile.TemporaryDirectory(prefix="ignis-sync-") as td:
            workdir = Path(td)
            (workdir / "experiment.py").write_text(experimentPy, encoding="utf-8")

            # Install requirements (same validation as execute_job)
            req_raw = (requirementsTxt or "").strip()
            if req_raw:
                lines: List[str] = []
                for ln in req_raw.splitlines():
                    s = ln.strip()
                    if not s or s.startswith("#"):
                        continue
                    bad = any(
                        s.startswith(pfx)
                        for pfx in ["-r", "--", "-e", "git+", "http://", "https://", "file:"]
                    )
                    bad = bad or ("==" in s) or (">=" in s) or ("<=" in s) or ("~=" in s) or ("@" in s) or ("/" in s)
                    if bad:
                        return {
                            "exitCode": 1,
                            "stdout": "",
                            "stderr": f"Invalid requirements line: {s!r}",
                            "artifacts": [],
                        }
                    lines.append(s)

                if lines:
                    (workdir / "requirements.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
                    _log("pip.install.start.sync", traceId=traceId, count=len(lines), pkgs=lines[:30])
                    pip_proc = subprocess.run(
                        ["python", "-m", "pip", "install", "--no-cache-dir", "-r", "requirements.txt"],
                        cwd=str(workdir),
                        capture_output=True,
                        text=True,
                    )
                    _log("pip.install.end.sync", traceId=traceId, code=pip_proc.returncode)
                    if pip_proc.returncode != 0:
                        return {
                            "exitCode": 1,
                            "stdout": pip_proc.stdout or "",
                            "stderr": f"pip install failed:\n{pip_proc.stderr or ''}",
                            "artifacts": [],
                        }

            # Run experiment with --smoke_test for fast validation
            _log("experiment.exec.start.sync", traceId=traceId, data_dir=data_dir, smoke_test=True)
            t0 = time.time()
            proc = subprocess.run(
                ["python", "experiment.py", "--data_dir", data_dir, "--smoke_test"],
                cwd=str(workdir),
                capture_output=True,
                text=True,
            )
            ms = int((time.time() - t0) * 1000)
            exit_code = proc.returncode
            stdout = _truncate(proc.stdout or "", MAX_LOG_CHARS)
            stderr = _truncate(proc.stderr or "", MAX_LOG_CHARS)
            _log("experiment.exec.end.sync", traceId=traceId, exitCode=exit_code, ms=ms)

            # Collect artifact names (no upload in sync mode)
            for p in workdir.iterdir():
                if not p.is_file() or p.name == "experiment.py":
                    continue
                if p.suffix.lower() in [".png", ".csv"]:
                    artifacts.append({
                        "name": p.name,
                        "type": "image" if p.suffix.lower() == ".png" else "csv",
                    })

    except Exception as e:
        stderr = f"Runner error: {type(e).__name__}: {str(e)}"
        exit_code = 1

    return {
        "exitCode": exit_code,
        "stdout": stdout,
        "stderr": stderr,
        "artifacts": artifacts,
    }


@app.function(
    image=image,
    secrets=[kaggle_secret],
    volumes={DATASET_MOUNT: dataset_vol},
    timeout=60 * 30,  # 30 min max for sync execution
)
@modal.fastapi_endpoint(method="POST", label="run-sync")
def run_sync(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    POST /run-sync
    Synchronous execution - blocks until complete and returns results directly.
    Used by the run_experiment tool for agent-based iteration.

    Payload: { experimentPy, requirementsTxt, datasetJson, traceId? }
    Returns: { exitCode, stdout, stderr, artifacts }

    Key differences from async /run:
    - No jobId, jobToken, presignUrl, completeUrl required
    - Returns results directly in response body
    - No artifact upload (just returns names)
    - Shorter timeout (30 min vs 1 hour)
    """
    import importlib
    HTTPException = importlib.import_module("fastapi").HTTPException

    traceId = str(payload.get("traceId") or "").strip() or str(_now_ms())

    # Minimal validation (no jobId/callbacks needed for sync mode)
    experimentPy = str(payload.get("experimentPy") or "")
    requirementsTxt = str(payload.get("requirementsTxt") or "")
    datasetJson = str(payload.get("datasetJson") or "")

    _log("run_sync.received", traceId=traceId)

    if not experimentPy.strip():
        raise HTTPException(status_code=400, detail="experimentPy is empty")
    if not datasetJson.strip():
        raise HTTPException(status_code=400, detail="datasetJson is empty")

    try:
        kaggle_slug, unzip, subdir = _parse_dataset_json(datasetJson)
    except Exception as e:
        _log("run_sync.validation.error", traceId=traceId, message=str(e))
        raise HTTPException(status_code=400, detail=str(e))

    _log("run_sync.start", traceId=traceId, slug=kaggle_slug, unzip=unzip, subdir=subdir)

    # Execute synchronously (reuse shared logic)
    result = _execute_experiment_sync(
        traceId=traceId,
        experimentPy=experimentPy,
        requirementsTxt=requirementsTxt,
        kaggle_slug=kaggle_slug,
        unzip=unzip,
        subdir=subdir,
    )

    _log("run_sync.end", traceId=traceId, exitCode=result["exitCode"], artifactsCount=len(result.get("artifacts", [])))

    return result
