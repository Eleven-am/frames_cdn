import {
    CloudDrive,
    DriveFile,
    Env,
    File,
    ListFilesResponse,
    RecursiveFile,
    TokenResponse
} from "./cloudDrive";
import {createRouter} from "./router";

class GoogleDrive extends CloudDrive {

    constructor() {
        super();
    }

    async getFiles(folderId: string, pageToken?: string) {
        await this.#authenticate();

        const params = {
            q: `'${folderId}' in parents and trashed = false`,
            fields: 'nextPageToken, files(id, name, mimeType, size, parents)',
            orderBy: 'folder, name',
            pageSize: 1000,
            key: this.config.clientId,
            pageToken
        }

        const options = {
            method: 'GET',
            headers: {
                authorization: `Bearer ${this.token?.access_token}`,
            }
        }

        const address = `https://www.googleapis.com/drive/v3/files?${this.encodeObject(params)}`;

        let files: File[] = [];
        const returnedData = await this.makeRequest<ListFilesResponse>(address, options);

        if (returnedData) {
            files = returnedData.files.map((file) => {
                return {
                    fileName: file.name,
                    isFolder: file.mimeType === 'application/vnd.google-apps.folder',
                    mimeType: file.mimeType,
                    location: file.id,
                    size: file.size
                }
            });

            if (returnedData.nextPageToken) {
                const nextFiles = await this.getFiles(folderId, returnedData.nextPageToken);
                files.push(...nextFiles);
            }
        }

        return files;
    }

    async getRecursiveFiles(folderId: string) {
        const filesAndFolders = await this.getFiles(folderId);
        const files: RecursiveFile[] = filesAndFolders.filter((file) => !file.isFolder)
            .map((file) => ({
                ...file,
                parent: folderId
            }));

        const folders = filesAndFolders.filter((file) => file.isFolder);
        const folderChildren = await Promise.all(folders.map((folder) => this.getRecursiveFiles(folder.location)));

        folderChildren.forEach((children) => {
            files.push(...children);
        });

        return files;
    }

    async getFile(fileId: string) {
        await this.#authenticate();

        const params = {
            fields: 'id, name, mimeType, size, parents',
            key: this.config.clientId
        }

        const options = {
            method: 'GET',
            headers: {
                authorization: `Bearer ${this.token?.access_token}`,
            }
        }

        const address = `https://www.googleapis.com/drive/v3/files/${fileId}?${this.encodeObject(params)}`;

        const returnedData = await this.makeRequest<DriveFile>(address, options);

        if (returnedData) {
            return {
                fileName: returnedData.name,
                isFolder: returnedData.mimeType === 'application/vnd.google-apps.folder',
                mimeType: returnedData.mimeType,
                location: returnedData.id,
                size: returnedData.size
            }
        }

        return null;
    }

    async getRawFile(fileId: string, range?: string) {
        await this.#authenticate();

        const params = {
            alt: 'media',
        }

        const options = {
            method: 'GET',
            headers: {
                authorization: `Bearer ${this.token?.access_token}`,
            }
        }

        if (range) {
            // @ts-ignore
            options.headers['Range'] = range;
        }

        const address = `https://www.googleapis.com/drive/v3/files/${fileId}?${this.encodeObject(params)}`;

        return fetch(address, options);
    }

    async getToken(code: string) {
        this.token = null;

        const data = {
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
            redirect_uri: this.config.redirectUri,
            grant_type: 'authorization_code',
            code
        }

        const options = {
            method: 'POST',
            body: this.encodeObject(data),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }

        const returnedData = await this.makeRequest<TokenResponse>('https://oauth2.googleapis.com/token', options);

        if (returnedData) {
            this.token = {
                ...returnedData,
                expires_in: Date.now() + (returnedData.expires_in * 1000)
            }
        }

        return this.token;
    }

    generateAuthUrl() {
        const params = {
            client_id: this.config.clientId,
            redirect_uri: this.config.redirectUri,
            response_type: 'code',
            scope: 'https://www.googleapis.com/auth/drive.readonly',
            access_type: 'offline',
            prompt: 'consent'
        }

        return `https://accounts.google.com/o/oauth2/v2/auth?${this.encodeObject(params)}`;
    }

    async #authenticate() {
        if (this.token && this.token.expires_in > Date.now()) {
            return;
        }

        const data = {
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
            refresh_token: this.token?.refresh_token,
            grant_type: 'refresh_token'
        }

        const options = {
            method: 'POST',
            body: this.encodeObject(data),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
        }

        const returnedData = await this.makeRequest<{
            access_token: string
            refresh_token: string
        }>('https://www.googleapis.com/oauth2/v4/token', options);

        if (returnedData) {
            this.token = {
                access_token: returnedData.access_token,
                expires_in: 3600 * 1000 + Date.now(),
                refresh_token: this.token?.refresh_token || returnedData.refresh_token,
            }
        }
    }

    setConfig(env: Env): void {
        this.config = {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            redirectUri: `${env.BASE_URL}/google/oauth2callback`,
        };
    }

    getRootFolder(env: Env): string {
        return env.GOOGLE_ROOT_FOLDER;
    }
}

const googleDrive = new GoogleDrive();

const routerObject = createRouter(googleDrive, 'google');
export default routerObject.driveRouter;
export const isGoogleAuthenticated = routerObject.isDriveAuthenticated;
