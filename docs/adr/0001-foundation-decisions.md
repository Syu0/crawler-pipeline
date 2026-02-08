# ADR-0001: Foundation Architecture Decisions

**Status**: Accepted  
**Date**: 2025-02-08  
**Decision Makers**: Development Team

---

## Context

This project implements Step 3 of a Coupang-to-Qoo10 product pipeline. We need to establish foundational decisions for:

1. Technology stack
2. Safety mechanisms
3. Code organization
4. Default configurations

---

## Decisions

### 1. Technology Stack

**Decision**: Node.js with minimal dependencies

**Rationale**:
- Simple deployment requirements
- Native HTTPS module sufficient for QAPI
- dotenv for environment management
- No build step needed

**Consequences**:
- (+) Fast startup, small footprint
- (+) Easy to understand and maintain
- (-) No TypeScript type safety
- (-) Manual HTTP handling

### 2. Dry-Run Mode as Default

**Decision**: Real API calls require explicit opt-in via `QOO10_ALLOW_REAL_REG=1`

**Rationale**:
- Prevent accidental product creation
- Safe for testing and development
- Explicit action required for production use

**Consequences**:
- (+) Cannot accidentally create products
- (+) Safe CI/CD testing
- (-) Extra step for production use

### 3. Fixed SellerCode Prefix

**Decision**: SellerCode prefix is always `auto`, ignoring any input

**Rationale**:
- Prevents duplicate SellerCode errors
- Consistent naming convention
- Timestamp + random ensures uniqueness

**Consequences**:
- (+) No duplicate code errors
- (+) Predictable format: `auto{timestamp}{random}`
- (-) Cannot use custom prefixes

### 4. Fixed Default ShippingNo

**Decision**: Default ShippingNo is `471554`, no auto-resolve API call

**Rationale**:
- Reduces API calls
- Known working value for seller
- Can be overridden in JSON if needed

**Consequences**:
- (+) Faster registration (no lookup)
- (+) Works offline for dry-run
- (-) May need update if shipping group changes

### 5. Console-Based Logging

**Decision**: Use console.log/console.error for all logging

**Rationale**:
- Simple and sufficient for CLI tool
- No external dependencies
- Tracer mode provides detailed debugging

**Consequences**:
- (+) Zero configuration
- (+) Easy to read in terminal
- (-) No log levels or rotation
- (-) Not suitable for production monitoring

### 6. Single Option Group Limitation

**Decision**: Support only one option type per product (SIZE **or** COLOR, not both)

**Rationale**:
- Simpler implementation
- Matches current business requirements
- AdditionalOption format complexity

**Consequences**:
- (+) Simpler validation
- (+) Clear error messages
- (-) Cannot create SIZE+COLOR variants in single call

### 7. Environment File Location

**Decision**: Environment file at `backend/.env`, loaded via dotenv

**Rationale**:
- Separates backend config from frontend
- Standard dotenv pattern
- gitignored by default

**Consequences**:
- (+) Standard approach
- (+) No secrets in code
- (-) Must remember to copy .env.example

---

## Alternatives Considered

### TypeScript
- **Rejected**: Added complexity for a simple CLI tool
- **Revisit if**: Project grows significantly

### External HTTP Library (axios/got)
- **Rejected**: Native https sufficient
- **Revisit if**: Need advanced features (retries, interceptors)

### Structured Logger (winston/pino)
- **Rejected**: Overkill for CLI tool
- **Revisit if**: Need log aggregation

---

## References

- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [Qoo10 QAPI Documentation](https://api.qoo10.jp)
