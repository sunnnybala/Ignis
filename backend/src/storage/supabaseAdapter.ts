import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
const SUPABASE_BUCKET = (process.env.SUPABASE_STORAGE_BUCKET as string) || 'ignis-projects-dev';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
	console.warn('Supabase Storage not fully configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
}

const supabase = createClient(SUPABASE_URL || '', SUPABASE_SERVICE_ROLE_KEY || '');

export interface SignedUpload {
	key: string;
	signedUrl: string;
	token: string;
}

export async function putObject(
	key: string,
	data: ArrayBuffer | Buffer | Blob,
	contentType: string,
	upsert = true,
): Promise<void> {
	const { error } = await supabase.storage.from(SUPABASE_BUCKET).upload(key, data, {
		contentType,
		upsert,
	});
	if (error) throw error;
}

export async function getSignedUrl(key: string, expiresInSec = 300): Promise<string> {
	const { data, error } = await supabase.storage
		.from(SUPABASE_BUCKET)
		.createSignedUrl(key, expiresInSec);
	if (error) throw error;
	return data.signedUrl;
}

export async function getSignedUploadUrl(key: string): Promise<SignedUpload> {
	const { data, error } = await supabase.storage.from(SUPABASE_BUCKET).createSignedUploadUrl(key);
	if (error) throw error;
	return { key, signedUrl: data.signedUrl, token: data.token };
}

export async function deleteObject(key: string): Promise<void> {
	const { error } = await supabase.storage.from(SUPABASE_BUCKET).remove([key]);
	if (error) throw error;
}


