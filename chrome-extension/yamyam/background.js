'use strict';

const COOKIE_FILENAME = 'coupang_cookie.txt';

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (item.byExtensionId === chrome.runtime.id) {
    suggest({ filename: COOKIE_FILENAME, conflictAction: 'overwrite' });
  }
});
