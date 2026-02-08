# Runbook

Operational procedures for the Qoo10 product registration system.

---

## Quick Reference

| Task | Command |
|------|---------|
| Check environment | `npm run qoo10:env` |
| Test connection | `npm run qoo10:test:lookup` |
| Register sample (dry-run) | `npm run qoo10:register:sample` |
| Register with options | `npm run qoo10:register:with-options` |
| Register with images + options | `npm run qoo10:register:with-extraimages-options` |

---

## Environment Setup

### 1. Create Environment File

```bash
cp backend/.env.example backend/.env
```

### 2. Configure Variables

Edit `backend/.env`:

```bash
# Required
QOO10_SAK=your-seller-auth-key-here

# Optional (defaults shown)
QOO10_TRACER=0
QOO10_ALLOW_REAL_REG=0
```

### 3. Verify Setup

```bash
npm run qoo10:env
```

Expected output:
```
✓ QOO10_SAK is set
```

---

## Daily Operations

### Dry-Run Registration (Default)

Test registration without creating real products:

```bash
npm run qoo10:register:sample
```

Expected output:
```
⚠️  DRY-RUN MODE: Set QOO10_ALLOW_REAL_REG=1 in backend/.env to perform real registration.

=== Registration Result ===
Success: false
ResultCode: -1
ResultMsg: Dry-run mode - registration skipped
```

### Real Registration

1. Enable real registration in `backend/.env`:
   ```bash
   QOO10_ALLOW_REAL_REG=1
   ```

2. Run registration:
   ```bash
   npm run qoo10:register:sample
   ```

3. Expected output (success):
   ```
   === Registration Result ===
   Success: true
   ResultCode: 0
   ResultMsg: SUCCESS
   CreatedItemId (GdNo): 1234567890
   AIContentsNo: 9876543210
   ```

4. **Important**: Disable after testing:
   ```bash
   QOO10_ALLOW_REAL_REG=0
   ```

---

## Debugging

### Enable Tracer Mode

For detailed request/response logging:

```bash
# Option 1: Set in .env
QOO10_TRACER=1

# Option 2: Set inline
QOO10_TRACER=1 npm run qoo10:register:sample
```

Tracer output includes:
- Request URL and headers (key masked)
- Request body (URL-encoded params)
- Raw response
- Generated curl command (masked)

### Common Error Codes

| Code | Message | Cause | Solution |
|------|---------|-------|----------|
| `-999` | Object reference not set | Missing required field | Check all required fields |
| `-10001` | Duplicate seller code | SellerCode already exists | Code auto-generates unique codes |
| `-10004` | Invalid category | Bad SecondSubCat | Verify category ID |
| `0` | SUCCESS | Registration successful | - |

### Debug Harness

Run incremental parameter testing:

```bash
npm run qoo10:debug:setnewgoods
```

---

## Custom Product Registration

### Using Custom JSON

1. Create a JSON file with product data:
   ```json
   {
     "SecondSubCat": "320002604",
     "ItemTitle": "My Product",
     "ItemPrice": "5000",
     "ItemQty": "10",
     "StandardImage": "https://example.com/image.jpg",
     "ItemDescription": "<p>Description</p>"
   }
   ```

2. Run with custom file:
   ```bash
   node scripts/qoo10-register-cli.js path/to/your-product.json
   ```

### Adding Options

```json
{
  "Options": {
    "type": "SIZE",
    "values": [
      {"name": "S", "priceDelta": 0},
      {"name": "M", "priceDelta": 200}
    ]
  }
}
```

### Adding Extra Images

```json
{
  "ExtraImages": [
    "https://example.com/extra1.jpg",
    "https://example.com/extra2.jpg"
  ]
}
```

---

## Incident Response

### Registration Stuck

1. Check environment:
   ```bash
   npm run qoo10:env
   ```

2. Test connection:
   ```bash
   npm run qoo10:test:lookup
   ```

3. Enable tracer and retry:
   ```bash
   QOO10_TRACER=1 npm run qoo10:register:sample
   ```

### API Key Issues

If `QOO10_SAK not set` error:
1. Verify `backend/.env` exists
2. Check key is not empty
3. Restart terminal (if using exports)

### Network Issues

If connection timeout:
1. Check internet connectivity
2. Verify Qoo10 API is accessible
3. Check for IP restrictions

---

## Maintenance

### Update Documentation

After code changes:

```bash
npm run docs:sync
```

### Git Workflow

1. Create feature branch
2. Make changes
3. Update docs if needed
4. Submit PR using template

---

## Contacts

| Role | Contact |
|------|---------|
| Qoo10 API Support | TODO: Add contact |
| Sheet Admin | TODO: Add contact |

---

## Related Documents

- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture
- [SHEET_SCHEMA.md](./SHEET_SCHEMA.md) - Google Sheet schema
- [LOCAL_SETUP_STEPS.md](../LOCAL_SETUP_STEPS.md) - Detailed setup guide
