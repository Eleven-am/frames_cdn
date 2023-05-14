import {Router} from 'itty-router'
import {createCors} from 'itty-cors';
import googleRouter, {isGoogleAuthenticated} from "./googleDrive";
import dropboxRouter, {isDropboxAuthenticated} from "./dropbox";
import {json, missing} from "itty-router-extras";
import {Env} from "./cloudDrive";

const router = Router();

const {preflight, corsify: cors} = createCors({
    origins: ['*'],
    maxAge: 3600,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    headers: {
        'x-powered-by': 'itty-router',
    }
})

// @ts-ignore
router.all('*', preflight);
// @ts-ignore
router.get('/google/*', isGoogleAuthenticated, googleRouter.handle);
// @ts-ignore
router.get('/dropbox/*', isDropboxAuthenticated, dropboxRouter.handle);
router.get('/', () => cors(json({message: 'Hello, world!'})));
router.get('*', () => cors(missing()));

export default {
    fetch: (request: Request, env: Env) => router.handle(request, env),
};
