# Sensor Admin Portal

Clean, modern admin portal for managing Raspberry Pi devices and app users.

## Features

✅ **Dashboard** - Real-time statistics for devices and users  
✅ **Devices Management** - List all Raspberry Pi devices with toggle to restrict/allow data  
✅ **Users Management** - List all app users with block/unblock functionality  
✅ **Responsive Design** - Works on desktop and mobile  
✅ **Real-time Updates** - Auto-refresh every 30 seconds  

## Tech Stack

- **Backend:** Node.js + Express
- **Database:** PostgreSQL
- **Frontend:** Vanilla HTML/CSS/JavaScript (no framework needed)

## Quick Start

### 1. Install Dependencies

```bash
cd admin-portal-v2
npm install
```

### 2. Setup PostgreSQL Database

```bash
# Install PostgreSQL (if not installed)
sudo yum install postgresql15-server -y
sudo postgresql-setup initdb
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create database and tables
sudo -u postgres psql
```

In PostgreSQL shell:
```sql
CREATE DATABASE sensor_db;
\c sensor_db
\i database-schema.sql
\q
```

### 3. Configure Environment

```bash
cp .env.example .env
nano .env
```

Update with your database credentials:
```
PORT=3001
DB_HOST=localhost
DB_PORT=5432
DB_NAME=sensor_db
DB_USER=postgres
DB_PASSWORD=your_password
```

### 4. Run the Server

**Development:**
```bash
npm run dev
```

**Production:**
```bash
npm start
```

Or with PM2:
```bash
npm install -g pm2
pm2 start server.js --name admin-portal
pm2 save
pm2 startup
```

### 5. Access the Portal

Open browser: `http://localhost:3001`

## API Endpoints

### Dashboard
- `GET /api/dashboard/stats` - Get dashboard statistics

### Devices
- `GET /api/devices` - List all devices
- `PUT /api/devices/:deviceId/toggle` - Toggle device active status
- `PUT /api/devices/:deviceId` - Update device details

### Users
- `GET /api/users` - List all app users
- `PUT /api/users/:userId/toggle-block` - Toggle user block status

### Health
- `GET /health` - Check server and database status

## Deployment on AWS EC2

### Security Group Settings

Allow inbound traffic:
- Port 3001 (or your configured PORT)
- Port 80 (if using reverse proxy)
- Port 443 (if using HTTPS)

### Using Nginx as Reverse Proxy

```bash
sudo yum install nginx -y

# Edit nginx config
sudo nano /etc/nginx/conf.d/admin-portal.conf
```

Add:
```nginx
server {
    listen 80;
    server_name your-ec2-public-ip;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo systemctl start nginx
sudo systemctl enable nginx
```

Now access at: `http://your-ec2-public-ip`

## Database Management

### Add a new device manually:
```sql
INSERT INTO devices (device_id, device_name, location, is_active)
VALUES ('rpi-005', 'Raspberry Pi 5', 'Building C', true);
```

### Add a new user manually:
```sql
INSERT INTO app_users (user_id, email, display_name, is_blocked)
VALUES ('user-004', 'new.user@example.com', 'New User', false);
```

### View all devices:
```sql
SELECT * FROM devices ORDER BY created_at DESC;
```

### View blocked users:
```sql
SELECT * FROM app_users WHERE is_blocked = true;
```

## Troubleshooting

### Cannot connect to database
```bash
# Check PostgreSQL is running
sudo systemctl status postgresql

# Check connection
psql -U postgres -d sensor_db -h localhost
```

### Port already in use
```bash
# Find process using port 3001
sudo lsof -i :3001
# Or
sudo netstat -tulpn | grep 3001

# Kill the process
sudo kill -9 <PID>
```

### Empty tables
```bash
# Re-run the schema with sample data
psql -U postgres -d sensor_db -f database-schema.sql
```

## Security Notes

⚠️ **For production deployment:**

1. Add authentication middleware (JWT or session-based)
2. Use HTTPS with SSL certificate
3. Set strong database passwords
4. Configure CORS properly
5. Add rate limiting
6. Enable PostgreSQL password authentication
7. Use environment variables for secrets

## License

MIT
