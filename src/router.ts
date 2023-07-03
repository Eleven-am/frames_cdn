import {
    CloudDrive,
    CloudProvider,
    DriveRequest,
    Env,
    KVMessage,
    TokenResponse
} from "./cloudDrive";
import {DropBox} from "./dropbox";
import {GoogleDrive} from "./googleDrive";
import {IRequest, Router} from "itty-router";

function uuid (): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
        .replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);

            return v.toString(16);
        });
}

export function cors(response: Response): Response {
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With, Accept, Range');
    response.headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Content-Disposition');

    return response;
}

function redirect(url: string): Response {
    return Response.redirect(url, 302)
}
export function error(code: number, message: string): Response {
    const response = new Response(message, {status: code});

    return cors(response);
}

export function json(data: any): Response {
    const response = new Response(JSON.stringify(data, null, 2), {
        headers: {
            'Content-Type': 'application/json',
        },
    });

    return cors(response);
}

export function missing(message = 'Not Found'): Response {
    return error(404, message);
}

export function preflight(request: IRequest): Response | void {
    if (request.method === 'OPTIONS') {
        return cors(new Response(null, {
            status: 204,
        }));
    }
}

function getProvider (provider: string, env: Env): CloudDrive | null {
    let drive: CloudDrive | null = null;
    switch (provider) {
        case CloudProvider.DROPBOX:
            drive = new DropBox();
            break;
        case CloudProvider.GOOGLE:
            drive = new GoogleDrive();
            break;
        default:
            return null;
    }

    if (drive !== null) {
        drive.setConfig(env);
    }

    return drive;
}

function isAuthorized(reader: CloudDrive, request: IRequest): boolean {
    const token = reader.token;
    if (token !== null) {
        return true;
    }

    const url = new URL(request.url);
    const acceptedRoutes = ['/download', '/stream', 'auth']
    if (acceptedRoutes.includes(url.pathname)) {
        return true;
    }

    const code = url.searchParams.get('code');
    if (code !== null) {
        return true;
    }

    const authorization = request.headers.get('Authorization');
    if (authorization === null) {
        return false;
    }

    const [type, tokenValue] = authorization.split(' ');
    if (type !== 'Bearer') {
        return false;
    }

    const decoded = atob(tokenValue);
    const tokenResponse = JSON.parse(decoded) as TokenResponse;
    if (tokenResponse.access_token === undefined || tokenResponse.expiry_date === undefined || tokenResponse.refresh_token === undefined) {
        return false;
    }

    reader.token = tokenResponse;
    return true;
}

export function isDriveAuthenticated(request: IRequest, env: Env) {
    const url = new URL(request.url);
    const provider = url.pathname.split('/')[1];

    if (provider === null) {
        return error(400, 'Missing provider');
    }

    const drive = getProvider(provider, env);

    if (drive === null) {
        return error(400, 'Invalid provider');
    }

    drive.setConfig(env);
    const isAuthorised = isAuthorized(drive, request);
    if (!isAuthorised) {
        return redirect(drive.generateAuthUrl());
    }

    request.drive = drive;
}

async function saveToken(env: Env, message: KVMessage) {
    const randomId = uuid();
    await env.FILES.put(randomId, JSON.stringify(message), {expirationTtl: 5 * 60 * 60});

    return randomId;
}

async function getToken(env: Env, fileId: string) {
    const message = await env.FILES.get<KVMessage>(fileId, 'json');
    if (message === null) {
        return null;
    }

    const reader = getProvider(message.type, env);

    if (reader === null) {
        return null;
    }

    reader.token = message.token;
    return {reader, message};
}

function stream(res: Response, mimeType: string): Response {
    if (!res.ok) {
        return error(res.status, res.statusText);
    }

    const {headers} = res = new Response(res.body, res);
    headers.set('Content-Disposition', 'inline');
    headers.set('Content-Type', mimeType);

    return cors(res);
}

function download(res: Response, fileName: string, mimeType: string): Response {
    if (!res.ok) {
        return error(res.status, res.statusText);
    }

    const {headers} = res = new Response(res.body, res);
    headers.set('Content-Disposition', `attachment; filename="${fileName}"`);
    headers.set('Content-Type', mimeType);

    return cors(res);
}

export function createRouter (basePath: CloudProvider) {
    const router = Router({base: `/${basePath}`});

    router.all('*', preflight);

    // @ts-ignore
    router.get('/oauth2callback', async (request: DriveRequest) => {
        const url = new URL(request.url);
        const code = url.searchParams.get('code');

        if (!code) {
            return error(400, 'Missing code');
        }

        const token = await request.drive.getToken(code);

        if (!token) {
            return error(500, 'Failed to get token');
        }

        const encodedToken = btoa(JSON.stringify(token));
        return json({token: encodedToken});
    });

    // @ts-ignore
    router.get('/auth', (request: DriveRequest) => redirect(request.drive.generateAuthUrl()));

    // @ts-ignore
    router.get('/', async ({drive}: DriveRequest, env: Env) => {
        const files = await drive.getFiles(drive.getRootFolder(env));

        drive.token = null;
        return json(files);
    });

    // @ts-ignore
    router.get('/:path', async ({params, drive}: DriveRequest) => {
        const parent = await drive.getFile(params.path);
        if (parent === null) {
            return missing();
        }

        if (!parent.isFolder) {
            return error(400, 'Not a folder');
        }

        const files = await drive.getFiles(params.path);

        drive.token = null;
        return json({parent, files});
    });

    // @ts-ignore
    router.get('/:path/recursive',async ({params, drive}: DriveRequest) => {
        const parent = await drive.getFile(params.path);
        if (parent === null) {
            return missing();
        }

        if (!parent.isFolder) {
            return error(400, 'Not a folder');
        }

        const files = await drive.getRecursiveFiles(params.path);

        drive.token = null;
        return json({parent, files});
    });

    // @ts-ignore
    router.get('/file/:id', async ({params, drive}: DriveRequest) => {
        const file = await drive.getFile(params.id);

        if (!file) {
            return missing();
        }

        if (file.isFolder) {
            return error(400, 'Not a file');
        }

        drive.token = null;
        return json(file);
    });

    // @ts-ignore
    router.get('/file/:id/stream', async (request: DriveRequest) => {
        const {id} = request.params;
        const range = request.headers.get('range');

        const file = await request.drive.getFile(id);
        if (!file) {
            return missing();
        }

        if (file.isFolder) {
            return error(400, 'Not a file');
        }

        let res = await request.drive.getRawFile(id, range);

        request.drive.token = null;
        return stream(res, file.mimeType);
    });

    // @ts-ignore
    router.get('/file/:id/download', async ({params, drive}: DriveRequest) => {
        const file = await drive.getFile(params.id);
        if (!file) {
            return missing();
        }

        if (file.isFolder) {
            return error(400, 'Not a file');
        }

        let res = await drive.getRawFile(params.id);

        drive.token = null;
        return download(res, file.fileName, file.mimeType);
    });

    // @ts-ignore
    router.get('/kv/write/:id', async (request: DriveRequest, env: Env) => {
        const params = request.params;
        const drive = request.drive;
        const file = await drive.getFile(params.id);
        const notInline = request.query.download === 'true';

        if (!file) {
            return missing();
        }

        if (file.isFolder) {
            return error(400, 'Cannot write folder');
        }

        const token = drive.token;

        if (!token) {
            return error(500, 'Failed to get token');
        }

        const message: KVMessage = {
            fileId: params.id,
            token: token,
            type: basePath,
            inline: !notInline,
        }

        const randomId = await saveToken(env, message);

        drive.token = null;
        return json({id: randomId});
    });

    router.get('*', () => missing('Invalid endpoint'));

    return router.handle;
}

export async function handleRead (request: IRequest, env: Env): Promise<Response> {
    const message = await getToken(env, request.params.uuid);
    if (!message) {
        return missing();
    }

    const drive = message.reader;
    const {fileId, token, inline} = message.message;

    const range = request.headers.get('range');

    drive.token = token;
    const file = await drive.getFile(fileId);
    if (!file) {
        return missing();
    }

    if (file.isFolder) {
        return error(400, 'Not a file');
    }

    let res = await drive.getRawFile(fileId, range);
    drive.token = null;

    if (inline) {
        return stream(res, file.mimeType);
    }

    return download(res, file.fileName, file.mimeType);
}
