import {
    CloudDrive,
    DropBoxFile,
    DropBoxGetFilesResponse,
    Env,
    File,
    RecursiveFile,
    TokenResponse
} from "./cloudDrive";
import {createRouter} from "./router";

class DropBox extends CloudDrive {

    constructor() {
        super();
    }

    async getFile(fileId: string) {
        await this.#authenticate();

        const options = {
            method: 'POST',
            body: JSON.stringify({
                path: fileId
            }),
            headers: {
                authorization: `Bearer ${this.token?.access_token}`,
                'Content-Type': 'application/json'
            }
        }

        const returnedData = await this.makeRequest<DropBoxFile>('https://api.dropboxapi.com/2/files/get_metadata', options);

        if (!returnedData) {
            return null;
        }

        return this.#parseFile(returnedData);
    }

    generateAuthUrl() {
        const params = {
            client_id: this.config.clientId,
            redirect_uri: this.config.redirectUri,
            response_type: 'code',
            token_access_type: 'offline',
            scope: 'files.metadata.read files.content.read files.content.write files.metadata.write'
        }

        return `https://www.dropbox.com/oauth2/authorize?${this.encodeObject(params)}`;
    }

    getFiles(folderId: string): Promise<File[]> {
        return this.#retrieveFiles(folderId);
    }

    getRawFile(fileId: string, range?: string): Promise<Response> {
        const options = {
            method: 'POST',
            headers: {
                authorization: `Bearer ${this.token?.access_token}`,
                'Dropbox-API-Arg': JSON.stringify({
                    path: fileId
                }),
                'Content-Type': 'application/octet-stream'
            }
        }

        if (range) {
            // @ts-ignore
            options.headers['Range'] = range;
        }

        return fetch('https://content.dropboxapi.com/2/files/download', options);
    }

    getRecursiveFiles(folderId: string): Promise<RecursiveFile[]> {
        return this.#retrieveFiles(folderId, true);
    }

    async getToken(code: string): Promise<TokenResponse | null> {
        this.token = null;
        const data = {
            code,
            grant_type: 'authorization_code',
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
            redirect_uri: this.config.redirectUri,
        }

        const url = `https://api.dropboxapi.com/oauth2/token?${this.encodeObject(data)}`;

        const returnedData = await this.makeRequest<TokenResponse>(url, {method: 'POST'});

        if (returnedData) {
            this.token = {
                ...returnedData,
                expires_in: Date.now() + (returnedData.expires_in * 1000)
            }
        }

        return this.token;
    }

    async #authenticate() {
        if (this.token && this.token.expires_in > Date.now()) {
            return;
        }

        const data = {
            grant_type: 'refresh_token',
            refresh_token: this.token?.refresh_token,
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
        }

        const url = `https://api.dropboxapi.com/oauth2/token?${this.encodeObject(data)}`;

        const token = await this.makeRequest<TokenResponse>(url, {method: 'GET'});

        if (!token) {
            return null;
        }

        this.token = {
            ...token,
            expires_in: Date.now() + (token.expires_in * 1000)
        }
        return token;
    }

    async #retrieveFiles(folderId: string, recursive = false): Promise<RecursiveFile[]> {
        await this.#authenticate();

        const params = {
            recursive,
            path: folderId,
            include_media_info: true,
            include_deleted: false,
            include_has_explicit_shared_members: false,
            include_mounted_folders: true,
            include_non_downloadable_files: true
        }

        const options = {
            method: 'POST',
            body: JSON.stringify(params),
            headers: {
                authorization: `Bearer ${this.token?.access_token}`,
                'Content-Type': 'application/json'
            }
        }

        let returnedData = await this.makeRequest<DropBoxGetFilesResponse>('https://api.dropboxapi.com/2/files/list_folder', options);

        if (!returnedData) {
            return [];
        }

        let cursor = returnedData.cursor;
        const files = returnedData.entries.map(file => this.#parseFile(file));

        while (returnedData.has_more) {
            const options = {
                method: 'POST',
                body: JSON.stringify({
                    cursor
                }),
                headers: {
                    authorization: `Bearer ${this.token?.access_token}`,
                    'Content-Type': 'application/json'
                }
            }

            returnedData = await this.makeRequest<DropBoxGetFilesResponse>('https://api.dropboxapi.com/2/files/list_folder/continue', options);

            if (!returnedData) {
                break;
            }

            cursor = returnedData.cursor;
            files.push(...returnedData.entries.map(file => this.#parseFile(file)));
        }

        return files;
    }

    #parseFile(file: DropBoxFile): RecursiveFile {
        return {
            fileName: file.name,
            isFolder: file['.tag'] === 'folder',
            mimeType: this.#getMimeType(file.name),
            location: file.id,
            size: file.size || 0,
            parent: file.path_lower.split('/').slice(0, -1).join('/')
        }
    }

    #getMimeType(fileName: string) {
        const fileExtension = fileName.split('.').pop();
        if (!fileExtension) {
            return 'application/vnd.google-apps.folder';
        }

        const mimeTypes: { [key: string]: string } = {
            'pdf': 'application/pdf',
            'doc': 'application/msword',
            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'xls': 'application/vnd.ms-excel',
            'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'ppt': 'application/vnd.ms-powerpoint',
            'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'pps': 'application/vnd.ms-powerpoint',
            'ppsx': 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
            'odt': 'application/vnd.oasis.opendocument.text',
            'ods': 'application/vnd.oasis.opendocument.spreadsheet',
            'odp': 'application/vnd.oasis.opendocument.presentation',
            'txt': 'text/plain',
            'rtf': 'application/rtf',
            'html': 'text/html',
            'htm': 'text/html',
            'mht': 'message/rfc822',
            'mhtml': 'message/rfc822',
            'csv': 'text/csv',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'jpe': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'bmp': 'image/bmp',
            'tif': 'image/tiff',
            'tiff': 'image/tiff',
            'ico': 'image/x-icon',
            'svg': 'image/svg+xml',
            'svgz': 'image/svg+xml',
            'zip': 'application/zip',
            'rar': 'application/x-rar-compressed',
            'exe': 'application/x-msdownload',
            'msi': 'application/x-msdownload',
            'cab': 'application/vnd.ms-cab-compressed',
            'mp3': 'audio/mpeg',
            'qt': 'video/quicktime',
            'mov': 'video/quicktime',
            'wmv': 'video/x-ms-wmv',
            'mp4': 'video/mp4',
            'ogg': 'application/ogg',
            'ogv': 'video/ogg',
            'oga': 'audio/ogg',
            'webm': 'video/webm',
            'flv': 'video/x-flv',
            'avi': 'video/x-msvideo',
            'mkv': 'video/x-matroska',
            '3gp': 'video/3gpp',
            'wav': 'audio/x-wav',
            'mp4a': 'audio/mp4',
            'm4a': 'audio/mp4',
        }

        return mimeTypes[fileExtension] || 'application/octet-stream';
    }

    setConfig(env: Env): void {
        this.config = {
            clientId: env.DROPBOX_CLIENT_ID,
            clientSecret: env.DROPBOX_CLIENT_SECRET,
            redirectUri: `${env.BASE_URL}/dropbox/oauth2callback`,
        };
    }

    getRootFolder(env: Env): string {
        return "";
    }
}

const dropBox = new DropBox();

const routerObject = createRouter(dropBox, 'dropbox');
export default routerObject.driveRouter;
export const isDropboxAuthenticated = routerObject.isDriveAuthenticated;
