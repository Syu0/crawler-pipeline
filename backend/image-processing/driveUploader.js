/**
 * driveUploader.js — Google Drive 업로드 유틸 (service account 기반).
 *
 * 기존 `backend/keys/google-service-account.json`을 재사용하되, 스코프에 `drive`를 추가.
 *
 * 구조 주의:
 *   Service Account는 자체 Drive 스토리지가 없다 (2022 정책 변경). 따라서:
 *     - 옵션 1 (현재 prototype): SA가 자기 소유 폴더·파일 생성. "내 드라이브" 표시 X, 공개 URL은 OK.
 *     - 옵션 2 (실전 권장): 사용자가 Drive에 폴더 만들고 SA 이메일에 Editor 공유 → env `DRIVE_IMAGES_FOLDER_ID`로 지정.
 *
 * env (선택):
 *   DRIVE_IMAGES_FOLDER_ID  — 지정 시 해당 폴더에 업로드. 없으면 SA 자기 공간에 `crawler-pipeline-images/` 폴더 자동 생성.
 */

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive'];
const DEFAULT_FOLDER_NAME = 'crawler-pipeline-images';

let _cachedDrive = null;
let _cachedFolderId = null;

async function getDriveClient() {
  if (_cachedDrive) return _cachedDrive;
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH;
  if (!keyPath) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON_PATH not set');
  const absolutePath = path.resolve(process.cwd(), keyPath);
  if (!fs.existsSync(absolutePath)) throw new Error(`Service account key not found: ${absolutePath}`);
  const auth = new google.auth.GoogleAuth({ keyFile: absolutePath, scopes: DRIVE_SCOPES });
  _cachedDrive = google.drive({ version: 'v3', auth });
  return _cachedDrive;
}

async function ensureFolder(folderName = DEFAULT_FOLDER_NAME, parentId = null) {
  if (_cachedFolderId) return _cachedFolderId;

  // env override takes precedence
  if (process.env.DRIVE_IMAGES_FOLDER_ID) {
    _cachedFolderId = process.env.DRIVE_IMAGES_FOLDER_ID;
    return _cachedFolderId;
  }

  const drive = await getDriveClient();

  // 기존 폴더 탐색 (SA 공간 + shared)
  const qParts = [
    `mimeType='application/vnd.google-apps.folder'`,
    `name='${folderName.replace(/'/g, "\\'")}'`,
    `trashed=false`,
  ];
  if (parentId) qParts.push(`'${parentId}' in parents`);

  const listRes = await drive.files.list({
    q: qParts.join(' and '),
    fields: 'files(id, name, owners)',
    pageSize: 10,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });

  if (listRes.data.files && listRes.data.files.length > 0) {
    _cachedFolderId = listRes.data.files[0].id;
    return _cachedFolderId;
  }

  // 없으면 생성
  const createRes = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : undefined,
    },
    fields: 'id',
    supportsAllDrives: true,
  });
  _cachedFolderId = createRes.data.id;
  return _cachedFolderId;
}

/**
 * 파일을 Drive에 업로드하고 공개 읽기 권한을 부여 후 공개 URL을 반환.
 *
 * @param {string} filePath 로컬 파일 경로
 * @param {string} driveFileName Drive 상 파일명 (충돌 시 Google이 자동 번호 붙임)
 * @param {object} opts
 * @param {string} [opts.mimeType='image/jpeg']
 * @param {string} [opts.folderId]  부모 폴더 ID 지정 (없으면 ensureFolder)
 * @returns {Promise<{id, name, webViewLink, directUrl, size}>}
 */
async function uploadAndShare(filePath, driveFileName, opts = {}) {
  const { mimeType = 'image/jpeg', folderId } = opts;
  const drive = await getDriveClient();
  const parentId = folderId || (await ensureFolder());

  const createRes = await drive.files.create({
    requestBody: {
      name: driveFileName,
      parents: [parentId],
    },
    media: {
      mimeType,
      body: fs.createReadStream(filePath),
    },
    fields: 'id, name, size, webViewLink',
    supportsAllDrives: true,
  });

  const fileId = createRes.data.id;

  // 공개 읽기 권한
  await drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' },
    supportsAllDrives: true,
  });

  return {
    id: fileId,
    name: createRes.data.name,
    size: Number(createRes.data.size || 0),
    webViewLink: createRes.data.webViewLink,
    directUrl: `https://drive.google.com/uc?export=view&id=${fileId}`,
  };
}

async function deleteFile(fileId) {
  const drive = await getDriveClient();
  await drive.files.delete({ fileId, supportsAllDrives: true });
}

module.exports = {
  getDriveClient,
  ensureFolder,
  uploadAndShare,
  deleteFile,
};
