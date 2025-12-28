# Ignis Modal Runner (MVP)

This directory contains the **Modal execution plane** for running project `experiment.py` remotely.

## What it does

- Exposes `POST /run` on Modal.
- Input comes from the Node backend: `{ traceId, jobId, runId, projectId, jobToken, experimentPy, datasetJson, presignUrl, completeUrl }`.
- Downloads Kaggle dataset per `datasetJson` and caches it in a **single shared Modal Volume**.
- Runs `experiment.py --data_dir <cached_dataset_path>`.
- Uploads binary artifacts (`.png`, `.csv`) to Supabase using **Node-issued presigned upload URLs**.
- Calls back Node `POST /jobs/:jobId/complete` with `resultsText`, exit code, and uploaded artifact metadata.

## Setup

1) Install and authenticate Modal locally:

```bash
pip install modal
modal setup
```

2) Create a Modal Secret for Kaggle (MVP: global creds):

- Secret name: `ignis-kaggle` (default)
- Env vars required:
  - `KAGGLE_USERNAME`
  - `KAGGLE_KEY`

3) Deploy:

```bash
modal deploy modal_runner/runner.py
```

## Notes

- The dataset cache volume name defaults to `ignis-datasets-cache`.
- The Kaggle secret name defaults to `ignis-kaggle`.
- Both can be changed via environment variables:
  - `IGNIS_DATASET_VOLUME_NAME`
  - `IGNIS_KAGGLE_SECRET_NAME`


