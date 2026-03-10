# EC2 Deployment Guide - Admin Portal

Complete guide to deploy the admin portal on your AWS EC2 instance.

## Prerequisites

- ✅ EC2 instance running (Amazon Linux 2023)
- ✅ SSH access or AWS Systems Manager Session Manager
- ✅ Repository pushed to GitHub: `https://github.com/rutaghacs/rutag-app-admin`
- ✅ Security group configured (see below)

---

## Quick Deploy (Automated Script)

### Step 1: Connect to EC2

**Option A: AWS Session Manager (No SSH key needed)**
1. Go to AWS Console → EC2 → Instances
2. Select your instance: `rutag-app-dep`
3. Click **Connect** → **Session Manager** → **Connect**

**Option B: SSH (If you have key pair)**
```bash
ssh -i your-key.pem ec2-user@your-ec2-public-ip
```

### Step 2: Download and Run Deployment Script

```bash
# Download the script
curl -O https://raw.githubusercontent.com/rutaghacs/rutag-app-admin/main/deploy-to-ec2.sh

# Make it executable
chmod +x deploy-to-ec2.sh

# Run deployment
./deploy-to-ec2.sh
```

**That's it!** The script will:
- ✅ Install PostgreSQL
- ✅ Install Node.js
- ✅ Clone your GitHub repo
- ✅ Setup database with schema
- ✅ Install dependencies
- ✅ Start the server with PM2

Access your portal at: `http://YOUR_EC2_PUBLIC_IP:3001`

---

## Manual Deployment (Step by Step)

If you prefer manual installation:

### 1. Update System
```bash
sudo yum update -y
```

### 2. Install PostgreSQL
```bash
sudo yum install postgresql15-server postgresql15 -y
sudo postgresql-setup --initdb
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

### 3. Configure PostgreSQL
```bash
# Edit pg_hba.conf for password authentication
sudo nano /var/lib/pgsql/data/pg_hba.conf
```

Change the lines to:
```
# TYPE  DATABASE        USER            ADDRESS                 METHOD
local   all             all                                     peer
host    all             all             127.0.0.1/32            md5
host    all             all             ::1/128                 md5
```

Restart PostgreSQL:
```bash
sudo systemctl restart postgresql
```

### 4. Create Database
```bash
sudo -u postgres psql
```

In PostgreSQL shell:
```sql
CREATE DATABASE sensor_db;
CREATE USER sensor_admin WITH PASSWORD 'sensor_admin_pass123';
GRANT ALL PRIVILEGES ON DATABASE sensor_db TO sensor_admin;
\q
```

### 5. Install Node.js
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash
source ~/.bashrc
nvm install --lts
node --version
```

### 6. Clone Repository
```bash
cd ~
git clone https://github.com/rutaghacs/rutag-app-admin.git
cd rutag-app-admin
```

### 7. Install Dependencies
```bash
npm install
```

### 8. Setup Database Schema
```bash
sudo -u postgres psql -d sensor_db -f database-schema.sql
```

### 9. Create Environment File
```bash
cat > .env << EOF
PORT=3001
DB_HOST=localhost
DB_PORT=5432
DB_NAME=sensor_db
DB_USER=sensor_admin
DB_PASSWORD=sensor_admin_pass123
EOF
```

### 10. Install PM2 and Start Server
```bash
npm install -g pm2
pm2 start server.js --name admin-portal
pm2 save
pm2 startup
```

Copy and run the command that PM2 outputs!

---

## Security Group Configuration

### Required Inbound Rules:

| Type | Protocol | Port | Source | Description |
|------|----------|------|--------|-------------|
| Custom TCP | TCP | 3001 | 0.0.0.0/0 | Admin Portal |
| SSH | TCP | 22 | Your IP | SSH Access |
| HTTP | TCP | 80 | 0.0.0.0/0 | (Optional) Nginx |
| HTTPS | TCP | 443 | 0.0.0.0/0 | (Optional) SSL |

### How to Update Security Group:

1. Go to EC2 Console
2. Click on your instance `rutag-app-dep`
3. Go to **Security** tab
4. Click on the Security Group
5. Click **Edit inbound rules**
6. Click **Add rule**
   - Type: Custom TCP
   - Port: 3001
   - Source: 0.0.0.0/0
7. Click **Save rules**

---

## Access the Portal

Once deployed, find your EC2 public IP:

```bash
# On EC2, run:
curl http://169.254.169.254/latest/meta-data/public-ipv4
```

Or get it from AWS Console:
1. EC2 → Instances
2. Select `rutag-app-dep`
3. Copy **Public IPv4 address**

Access: `http://YOUR_PUBLIC_IP:3001`

---

## PM2 Commands

```bash
# Check status
pm2 status

# View logs
pm2 logs admin-portal

# View real-time logs
pm2 logs admin-portal --lines 100

# Restart
pm2 restart admin-portal

# Stop
pm2 stop admin-portal

# Start
pm2 start admin-portal

# Monitor
pm2 monit
```

---

## Database Commands

### Connect to PostgreSQL
```bash
sudo -u postgres psql -d sensor_db
```

### View tables
```sql
\dt
```

### View devices
```sql
SELECT * FROM devices;
```

### View users
```sql
SELECT * FROM app_users;
```

### Add a device manually
```sql
INSERT INTO devices (device_id, device_name, location, is_active)
VALUES ('rpi-005', 'New Device', 'Lab C', true);
```

### Exit PostgreSQL
```sql
\q
```

---

## Optional: Setup Nginx Reverse Proxy

To access on port 80 instead of 3001:

```bash
# Install Nginx
sudo yum install nginx -y

# Create config
sudo bash -c 'cat > /etc/nginx/conf.d/admin-portal.conf << EOF
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF'

# Start Nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

Now access at: `http://YOUR_PUBLIC_IP` (port 80)

---

## Update Deployment

To pull latest changes from GitHub:

```bash
cd ~/rutag-app-admin
git pull origin main
npm install
pm2 restart admin-portal
```

---

## Troubleshooting

### Port 3001 not accessible
```bash
# Check if server is running
pm2 status

# Check port is listening
sudo netstat -tulpn | grep 3001

# Check security group allows port 3001
```

### Database connection error
```bash
# Check PostgreSQL is running
sudo systemctl status postgresql

# Test connection
psql -h localhost -U sensor_admin -d sensor_db
```

### PM2 not starting on reboot
```bash
pm2 startup
pm2 save
# Run the command PM2 outputs
```

### View application logs
```bash
pm2 logs admin-portal --lines 50
```

---

## Security Recommendations

For production:

1. **Change database password** in `.env` and PostgreSQL
2. **Add authentication** to admin portal (JWT/session)
3. **Use HTTPS** with SSL certificate (Let's Encrypt)
4. **Restrict SSH** to your IP only
5. **Setup CloudWatch** for monitoring
6. **Regular backups** of PostgreSQL database
7. **Use Elastic IP** so IP doesn't change on restart

---

## Cost Information

Running on **t2.micro** (free tier eligible):
- EC2 instance: $0 (free tier) or ~$8/month
- Data transfer: ~$1-2/month
- **Total: ~$0-10/month**

---

## Support

If deployment fails, check:
1. PM2 logs: `pm2 logs admin-portal`
2. PostgreSQL status: `sudo systemctl status postgresql`
3. Security group allows port 3001
4. EC2 instance is running

For issues, check the logs and error messages carefully!
