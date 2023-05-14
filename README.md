# Frames CDN

This is a small package that uses Cloudflare Workers to serve your files stored on Google Drive or Dropbox as a CDN.

## Usage

### Google Drive

1. Create a new Google Drive API project and enable the Drive API.
2. Create a new OAuth client ID and download the credentials as a JSON file.
3. Replace the data in wrangler.toml with the data from the JSON file.
4. Run `wrangler publish` to deploy the worker.

### Dropbox

1. Create a new Dropbox API project
2. Copy the Client ID and Client Secret into wrangler.toml
3. Run `wrangler publish` to deploy the worker.

### Endpoints

The worker has two main Provider endpoints:

- `/google/` - Google Drive
- `/dropbox/` - Dropbox

Both endpoints have the same parameters:

- `/:folderId` - The ID of the folder to list. If not specified, the root folder will be used.
- `/:folderId/recursive` - The ID of the folder to list. It lists all the files in the folder and its sub-folders.
- `/file/:fileId` - The ID of the file to serve. It displays the metadata of the file.
- `/file/:fileId/stream` - The ID of the file to serve. This endpoint sets the Content-Disposition header to inline. It also retrieves only the requested range of the file thus serving a partial response.
- `/file/:fileId/download` - On the other hand this endpoint sets the Content-Disposition header to attachment. It also retrieves the whole file and pipes this response to the client.

### Authentication

The worker uses the OAuth 2.0 protocol to authenticate the user. The user is redirected to the OAuth provider's login page and then redirected back to the worker with a code. The worker then exchanges the code for an access token. 

- `/auth` - Visiting the auth endpoint from any provider will redirect the user to the OAuth provider's login page. Once authenticated a JSON payload will be returned with the token (a base64 encoded JSON object).

For any subsequent requests the user must provide the token in the Authorization header. This base64 encoded token contains the access and refresh token for the provider. The worker will then use the access tokens to make requests to the provider's API.
If no token is provided the user would be redirected to the auth endpoint for authentication.
If the access token is expired the worker will use the refresh token to get a new access token.

## Contributing

Feel free to open an issue or a pull request.
