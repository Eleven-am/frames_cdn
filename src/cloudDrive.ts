export interface File {
    fileName: string;
    isFolder: boolean;
    location: string;
    mimeType: string;
    size: number;
}

export interface RecursiveFile extends File {
    parent: string;
}

export interface ListFilesResponse {
    nextPageToken?: string;
    kind: string;
    incompleteSearch: boolean;
    files: DriveFile[];
}

export interface DriveFile {
    id: string;
    name: string;
    mimeType: string;
    size: number;
    parents: string[];
}

export interface DriveOptions {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
}

export interface TokenResponse {
    access_token: string;
    expires_in: number;
    refresh_token: string;
}

export interface DropBoxGetFilesResponse {
    entries: DropBoxFile[],
    has_more: boolean,
    cursor: string
}

export interface DropBoxFile {
    '.tag': 'file' | 'folder';
    name: string;
    id: string;
    path_lower: string;
    path_display: string;
    size: number;
}

export type Cors = (response: Response) => Response;

export abstract class CloudDrive {
    #token: TokenResponse | null;
    #config: DriveOptions | null;

    protected constructor() {
        this.#token = null;
        this.#config = null;
    }

    set token(token: TokenResponse | null) {
        this.#token = token;
    }

    get token() {
        return this.#token;
    }

    protected get config(): DriveOptions {
        if (this.#config === null) {
            throw new Error('Config not set');
        }

        return this.#config;
    }

    protected set config(config: DriveOptions | null) {
        this.#config = config;
    }

    abstract getFile(fileId: string): Promise<File | null>;

    abstract getFiles(folderId: string): Promise<File[]>;

    abstract getRawFile(fileId: string, range?: string): Promise<Response>;

    abstract getRecursiveFiles(folderId: string): Promise<RecursiveFile[]>;

    abstract generateAuthUrl(state: boolean): string;

    abstract getToken(code: string): Promise<TokenResponse | null>;

    abstract setConfig(env: Env): void;

    abstract getRootFolder(env: Env): string;

    protected makeRequest<DataType>(url: string, options: RequestInit) {
        return new Promise<DataType | null>((resolve) => {
            fetch(url, options)
                .then((response) => {
                    if (response.ok) {
                        response.json()
                            .then((data) => {
                                resolve(data as unknown as DataType);
                            })
                            .catch(() => {
                                resolve(null);
                            });

                    } else {
                        response.json()
                            .then((data) => {
                                console.log(data);
                                resolve(null);
                            })
                            .catch(() => {
                                resolve(null);
                            });
                    }
                })
                .catch(() => {
                    resolve(null);
                });
        })
    }

    protected encodeObject(object: Record<string, string | number | undefined>) {
        return Object.keys(object)
            .map((key) => {
                if (object[key] === undefined) {
                    return '';
                }

                return encodeURIComponent(key) + '=' + encodeURIComponent(object[key]!);
            })
            .join('&');
    }
}

export interface Env {
    frames: R2Bucket;
    FILES: KVNamespace;
    GOOGLE_CLIENT_ID: string;
    DROPBOX_CLIENT_ID: string;
    DROPBOX_CLIENT_SECRET: string;
    GOOGLE_CLIENT_SECRET: string;
    GOOGLE_ROOT_FOLDER: string;
    BASE_URL: string;
}

export interface KVMessage {
    type: 'dropbox' | 'google';
    fileId: string;
    token: TokenResponse;
}
