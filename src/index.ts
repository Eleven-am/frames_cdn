import {Router} from 'itty-router'
import {CloudProvider, Env} from "./cloudDrive";
import {cors, createRouter, handleRead, isDriveAuthenticated, json, missing, preflight} from "./router";

const router = Router();

// @ts-ignore
router.all('*', preflight);
router.get(`/${CloudProvider.GOOGLE}/*`, isDriveAuthenticated, createRouter(CloudProvider.GOOGLE));
router.get(`/${CloudProvider.DROPBOX}/*`, isDriveAuthenticated, createRouter(CloudProvider.DROPBOX));
router.get('/:uuid', handleRead);
router.get('/', () => cors(json({
    message: 'Welcome to the cloud drive API',
})));
router.get('*', () => cors(missing()));

export default {
    fetch: (request: Request, env: Env) => router.handle(request, env),
};
