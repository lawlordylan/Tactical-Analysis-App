// Google Drive settings for share links (see docs/google-drive-setup.md).
// Both values are public by design: Google only accepts the client ID from the app's
// own web addresses, and the API key is limited to the Drive API from those addresses.
export const GOOGLE_CLIENT_ID = '16453813139-hfeij2b0mvpnnnven60sd1e3kjfd2ps8.apps.googleusercontent.com';
export const GOOGLE_API_KEY = 'AIzaSyApGqFD6Z1Oq90_O5dnPGxV3iWRUV4Wbss';

/** Only lets the app see and change files it created itself. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
