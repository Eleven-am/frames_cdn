import {
    CloudDrive, Cors, Env,
    KVMessage, TokenResponse,
} from "./cloudDrive";

import {Router} from "itty-router";
import {createCors} from "itty-cors";
import {error, json, missing} from 'itty-router-extras';

function uuid (): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
        .replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);

            return v.toString(16);
        });
}

function redirect(url: string): Response {
    return Response.redirect(url, 302)
}

async function saveToken(env: Env, message: KVMessage) {
    const randomId = uuid();
    await env.FILES.put(randomId, JSON.stringify(message), {expirationTtl: 5 * 60 * 60});

    return randomId;
}

async function getToken(env: Env, fileId: string): Promise<KVMessage | null> {
    const token = await env.FILES.get<KVMessage>(fileId, 'json');
    if (token === null) {
        return null;
    }

    return token;
}

function stream(res: Response, mimeType: string, cors: Cors): Response {
    if (!res.ok) {
        return cors(error(res.status, res.statusText));
    }

    const {headers} = res = new Response(res.body, res);
    headers.set('Content-Disposition', 'inline');
    headers.set('Content-Type', mimeType);

    return cors(res);
}

function download(res: Response, mimeType: string, cors: Cors): Response {
    if (!res.ok) {
        return cors(error(res.status, res.statusText));
    }

    const {headers} = res = new Response(res.body, res);
    headers.set('Content-Disposition', 'attachment');
    headers.set('Content-Type', mimeType);

    return cors(res);
}

function isAuthorized(reader: CloudDrive, request: Request): boolean {
    const token = reader.token;
    if (token !== null) {
        return true;
    }

    const url = new URL(request.url);
    if (url.pathname.includes('kv/read') || url.pathname.includes('auth')) {
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
    if (tokenResponse.access_token === undefined || tokenResponse.expires_in === undefined || tokenResponse.refresh_token === undefined) {
        return false;
    }

    reader.token = tokenResponse;
    return true;
}

export function createRouter (drive: CloudDrive, root: string, basePath: 'google' | 'dropbox') {
    const driveRouter = Router({base: `/${basePath}`});
    const {preflight, corsify: cors} = createCors({
        origins: ['*'],
        maxAge: 3600,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        headers: {
            'x-powered-by': 'cloudDrive-CDN',
        }
    })

    // @ts-ignore
    driveRouter.all('*', preflight);
    function isDriveAuthenticated(request: Request, env: Env) {
        drive.setConfig(env);
        const isAuthorised = isAuthorized(drive, request);
        if (!isAuthorised) {
            return cors(redirect(drive.generateAuthUrl(false)))
        }
    }

    driveRouter.get('/oauth2callback', async (request, env: Env) => {
        const url = new URL(request.url);
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const baseurl = env.BASE_URL;

        if (!code) {
            return cors(error(400, 'Missing code'));
        }

        const token = await drive.getToken(code);

        if (!token) {
            return cors(error(500, 'Failed to get token'));
        }

        if (state) {
            const encodedToken = btoa(JSON.stringify(token));
            return cors(json({token: encodedToken}));
        }

        return cors(redirect(`${baseurl}/${basePath}`));
    });

    driveRouter.get('/auth', () => redirect(drive.generateAuthUrl(true)));

    driveRouter.get('/', async () => {
        const files = await drive.getFiles(root);

        drive.token = null;
        return cors(json(files));
    });

    driveRouter.get('/:path', async ({params}) => {
        const parent = await drive.getFile(params.path);
        const files = await drive.getFiles(params.path);

        drive.token = null;
        return cors(json({parent, files}));
    });

    driveRouter.get('/:path/recursive',async ({params}) => {
        const parent = await drive.getFile(params.path);
        const files = await drive.getRecursiveFiles(params.path);

        drive.token = null;
        return cors(json({parent, files}));
    });

    driveRouter.get('/file/:id', async ({params}) => {
        const file = await drive.getFile(params.id);

        if (!file) {
            return cors(missing());
        }

        drive.token = null;
        return cors(json(file));
    });

    driveRouter.get('/file/:id/stream', async request => {
        const {id} = request.params;
        const range = request.headers.get('range');

        const file = await drive.getFile(id);
        if (!file) {
            return cors(missing());
        }

        let res = await drive.getRawFile(id, range);

        drive.token = null;
        return stream(res, file.mimeType, cors);
    });

    driveRouter.get('/file/:id/download', async ({params}) => {
        const file = await drive.getFile(params.id);
        if (!file) {
            return cors(missing());
        }

        let res = await drive.getRawFile(params.id);

        drive.token = null;
        return download(res, file.fileName, cors);
    });

    driveRouter.get('/kv/write/:id', async ({params}, env: Env) => {
        const file = await drive.getFile(params.id);
        if (!file) {
            return cors(missing());
        }

        if (file.isFolder) {
            return cors(error(400, 'Cannot write folder'));
        }

        const token = drive.token;

        if (!token) {
            return cors(error(500, 'Failed to get token'));
        }

        const message: KVMessage = {
            fileId: params.id,
            token: token,
            type: basePath
        }

        const randomId = await saveToken(env, message);

        drive.token = null;
        return cors(json({id: randomId}));
    });

    driveRouter.get('/kv/read/:id', async (request, env: Env) => {
        const message = await getToken(env, request.params.id);
        if (!message) {
            return cors(missing());
        }

        const {fileId, token, type} = message;
        if (type !== basePath) {
            return cors(error(400, 'Invalid type'));
        }

        const range = request.headers.get('range');

        drive.token = token;
        const file = await drive.getFile(fileId);
        if (!file) {
            return cors(missing());
        }

        let res = await drive.getRawFile(fileId, range);

        drive.token = null;
        return stream(res, file.mimeType, cors);
    });

    driveRouter.get('*', () => cors(missing('Invalid endpoint')));

    return {
        driveRouter,
        isDriveAuthenticated
    }
}
