/**
 * URLs of short life to a storage (docs/FILES_AND_PANELS.md §1): who uploads or reads goes to the storage with them,
 * never through the gateway. S3 and Azure Blob behind it.
 */
export interface SignedRequest {
	url: string
	method: 'GET' | 'PUT'
	/** the headers the request must carry, as they were signed */
	headers: Record<string, string>
}

export interface UploadSpec { key: string, type: string, size: number, expiresSeconds: number }

export interface UrlSignerPort {
	upload (spec: UploadSpec): SignedRequest
	read (key: string, expiresSeconds: number): SignedRequest
}
