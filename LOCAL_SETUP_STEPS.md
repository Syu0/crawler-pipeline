# Qoo10 QAPI Debug - Local Setup Steps

## After Pulling Latest Code

### 1. Switch to emergent branch and pull
```bash
cd /app
git checkout emergent
git pull
```

### 2. Install dependencies (including dotenv)
```bash
npm install
```

Expected output:
```
added 1 package
✓ dotenv@17.2.4
```

### 3. Create backend/.env from template
```bash
cp backend/.env.example backend/.env
```

### 4. Edit backend/.env and add your Qoo10 SAK
```bash
# Edit backend/.env
nano backend/.env
# or
vim backend/.env
```

Add your credentials:
```bash
QOO10_SAK=your-actual-seller-auth-key-here
QOO10_ALLOW_REAL_REG=0
QOO10_TRACER=0
```

**To enable real registration** (instead of dry-run):
```bash
QOO10_SAK=your-key
QOO10_ALLOW_REAL_REG=1
QOO10_TRACER=0
```

---

## Environment Variables (backend/.env)

| Variable | Default | Description |
|----------|---------|-------------|
| `QOO10_SAK` | - | **Required:** Seller Auth Key from Qoo10 |
| `QOO10_ALLOW_REAL_REG` | `0` | Set to `1` to enable real registration (default: dry-run) |
| `QOO10_TRACER` | `0` | Set to `1` for verbose logging |

### Common Gotcha ⚠️

**Setting env vars only in terminal session is temporary and will be lost.**

❌ **Wrong:** `export QOO10_ALLOW_REAL_REG=1 && npm run ...`  
✅ **Right:** Add to `backend/.env` file

**Why?** Terminal exports don't persist. Use `backend/.env` for permanent settings.

---

### 5. Test connection (sanity check)
```bash
npm run qoo10:test:lookup
```

Expected output:
```
Testing Qoo10 connection (GetSellerDeliveryGroupInfo)...

Response: {
  "ResultCode": 0,
  "ResultMsg": "Success",
  ...
}

✓ Connection OK
```

### 6. Run debug harness
```bash
npm run qoo10:debug:setnewgoods
```

Expected output:
```
=== Qoo10 SetNewGoods Parameter Debug ===

Testing incrementally from minimal params...

[Test 1] Minimal params only
Params: returnType, SecondSubCat, ItemTitle, ItemPrice, ItemQty, ...
→ ResultCode: -999, Msg: Object reference not set to an instance of an object.

[Test 2] Adding: StandardImage
→ ResultCode: -999, Msg: Object reference not set to an instance of an object.

[Test 3] Adding: ItemDescription
→ ResultCode: 0, Msg: Success
✓ SUCCESS! Found working param combination.

=== Summary Table ===

Test                 | Code | Message
----------------------------------------------------------------------
Minimal              | -999 | Object reference not set...
+StandardImage       | -999 | Object reference not set...
+ItemDescription     | 0    | Success

=== Debug Complete ===
```

---

## Cross-Platform Support

### Windows (Git Bash/MINGW)
```bash
npm run qoo10:test:lookup
npm run qoo10:debug:setnewgoods
```

### Windows (PowerShell)
```powershell
npm run qoo10:test:lookup
npm run qoo10:debug:setnewgoods
```

### macOS/Linux
```bash
npm run qoo10:test:lookup
npm run qoo10:debug:setnewgoods
```

All platforms use identical commands - no shell-specific syntax.

---

## Key Points

✅ **No manual export needed** - scripts auto-load `backend/.env`  
✅ **Cross-platform** - works on Windows, macOS, Linux without modifications  
✅ **Secrets stay local** - `backend/.env` is gitignored  
✅ **One-time setup** - just `cp .env.example .env` and fill in SAK  
✅ **All commands from repo root** - `cd /app && npm run qoo10:*`  

---

## Troubleshooting

**"QOO10_SAK not set"**  
→ Ensure `backend/.env` exists and contains `QOO10_SAK=your-key`

**Windows error: "잘못된 매개 변수입니다" or "Invalid parameter"**  
→ Fixed in latest version - pull latest and try again (no MODE=... syntax used anymore)

**"npm: command not found" or "yarn: command not found"**  
→ Use `npm install` (yarn is aliased to npm in this environment)

**Changes not showing up after git pull**  
→ Run `npm install` again to update dependencies

---

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run qoo10:env` | Validate QOO10_SAK is set |
| `npm run qoo10:test:lookup` | Sanity check connection |
| `npm run qoo10:debug:setnewgoods` | Binary search param harness |

All scripts include automatic env validation.

---

**Full documentation:** `/app/QAPI_DEBUG_SETUP.md`  
**Tutorial:** https://emergent.sh/tutorial/moltbot-on-emergent
