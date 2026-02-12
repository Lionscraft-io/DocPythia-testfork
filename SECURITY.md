# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability, please report it responsibly.

### How to Report

1. **Do NOT** create a public GitHub issue for security vulnerabilities
2. Email security concerns to: [security@lionscraft.dev](mailto:security@lionscraft.dev)
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Any suggested fixes

### What to Expect

- **Acknowledgment**: We will acknowledge receipt within 48 hours
- **Assessment**: We will assess the vulnerability within 7 days
- **Resolution**: Critical issues will be addressed within 30 days
- **Disclosure**: We will coordinate disclosure timing with you

## Security Best Practices

When deploying DocPythia, follow these security guidelines:

### Environment Variables

- Never commit `.env` files to version control
- Use strong, unique passwords for database access
- Rotate API keys regularly
- Use secrets management in production (AWS Secrets Manager, HashiCorp Vault, etc.)

### Authentication

- Change default admin passwords immediately
- Use strong passwords (16+ characters, mixed case, numbers, symbols)
- Admin tokens should be long, random strings
- Consider implementing rate limiting for auth endpoints

### Database

- Use a dedicated database user with minimal privileges
- Enable SSL/TLS for database connections
- Keep PostgreSQL updated to latest stable version
- Regular backups with encryption

### Network

- Deploy behind a reverse proxy (nginx, Caddy)
- Enable HTTPS with valid certificates
- Configure CORS appropriately for your domain
- Use firewall rules to restrict database access

### Docker

- Don't run containers as root (image already uses non-root user)
- Keep base images updated
- Scan images for vulnerabilities
- Use read-only file systems where possible

### API Keys

- Store API keys in environment variables, not code
- Use separate keys for development and production
- Implement key rotation procedures
- Monitor for unusual API usage patterns

## Known Security Considerations

### Password Hashing

- Passwords are hashed using bcrypt with a cost factor of 12
- Legacy SHA256 hashes are supported for migration but should be upgraded

### Session Storage

- Admin tokens are stored in sessionStorage (browser)
- Consider httpOnly cookies for enhanced XSS protection in production

### File Uploads

- Uploaded files are stored in `/tmp/uploads`
- Implement file type validation
- Consider virus scanning for uploaded content

## Security Updates

Security updates will be released as patch versions. We recommend:

1. Subscribe to release notifications
2. Apply security updates promptly
3. Review changelogs for security-related fixes

## Acknowledgments

We appreciate security researchers who responsibly disclose vulnerabilities. Contributors will be acknowledged (with permission) in our security advisories.
