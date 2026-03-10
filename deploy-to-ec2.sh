#!/bin/bash

# ============================================
# EC2 Deployment Script for Admin Portal
# Amazon Linux 2023
# ============================================

set -e  # Exit on any error

echo "=========================================="
echo "Starting Admin Portal Deployment on EC2"
echo "=========================================="

# ============================================
# 1. UPDATE SYSTEM
# ============================================
echo "[1/8] Updating system packages..."
sudo yum update -y

# ============================================
# 2. INSTALL POSTGRESQL
# ============================================
echo "[2/8] Installing PostgreSQL..."
sudo yum install postgresql15-server postgresql15 -y

# Initialize PostgreSQL
if [ ! -f /var/lib/pgsql/data/PG_VERSION ]; then
    echo "Initializing PostgreSQL database..."
    sudo postgresql-setup --initdb
fi

# Start and enable PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

echo "PostgreSQL installed and running!"

# ============================================
# 3. INSTALL GIT
# ============================================
echo "[3/8] Installing Git..."
sudo yum install git -y
echo "Git $(git --version) installed!"

# ============================================
# 4. INSTALL NODE.JS
# ============================================
echo "[4/8] Installing Node.js via NVM..."
if [ ! -d "$HOME/.nvm" ]; then
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
fi

# Load NVM
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

nvm install --lts
nvm use --lts

echo "Node.js $(node --version) installed!"
echo "npm $(npm --version) installed!"

# ============================================
# 5. CLONE GITHUB REPOSITORY
# ============================================
echo "[5/8] Cloning GitHub repository..."
cd ~
REPO_DIR="$HOME/rutag-app-admin"

if [ -d "$REPO_DIR" ]; then
    echo "Repository already exists, pulling latest changes..."
    cd "$REPO_DIR"
    git pull origin main
else
    git clone https://github.com/rutaghacs/rutag-app-admin.git "$REPO_DIR"
    cd "$REPO_DIR"
fi

# ============================================
# 6. INSTALL NPM DEPENDENCIES
# ============================================
echo "[6/8] Installing npm dependencies..."
npm install

# ============================================
# 7. CONFIGURE POSTGRESQL DATABASE
# ============================================
echo "[7/8] Setting up PostgreSQL database..."

# Configure pg_hba.conf to allow local connections
sudo bash -c 'cat > /var/lib/pgsql/data/pg_hba.conf << EOF
# TYPE  DATABASE        USER            ADDRESS                 METHOD
local   all             all                                     peer
host    all             all             127.0.0.1/32            md5
host    all             all             ::1/128                 md5
EOF'

# Restart PostgreSQL to apply changes
sudo systemctl restart postgresql

# Create database and user
sudo -u postgres psql << EOF
-- Create database if not exists
SELECT 'CREATE DATABASE sensor_db'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'sensor_db')\gexec

-- Create user if not exists
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_user WHERE usename = 'sensor_admin') THEN
    CREATE USER sensor_admin WITH PASSWORD 'sensor_admin_pass123';
  END IF;
END
\$\$;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE sensor_db TO sensor_admin;
\q
EOF

# Run database schema
sudo -u postgres psql -d sensor_db -f "$REPO_DIR/database-schema.sql"

echo "PostgreSQL database configured!"

# ============================================
# 8. CREATE ENVIRONMENT FILE
# ============================================
echo "[8/8] Creating environment configuration..."

cat > "$REPO_DIR/.env" << EOF
# Server Configuration
PORT=3001

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=sensor_db
DB_USER=sensor_admin
DB_PASSWORD=sensor_admin_pass123
EOF

echo ".env file created!"

# ============================================
# 9. INSTALL AND CONFIGURE PM2
# ============================================
echo "[9/9] Setting up PM2 process manager..."

npm install -g pm2

# Stop any existing process
pm2 stop admin-portal 2>/dev/null || true
pm2 delete admin-portal 2>/dev/null || true

# Start the application
cd "$REPO_DIR"
pm2 start server.js --name admin-portal

# Save PM2 configuration
pm2 save

# Setup PM2 startup script
sudo env PATH=$PATH:$(which node) $(which pm2) startup systemd -u $USER --hp $HOME

echo ""
echo "=========================================="
echo "✅ Deployment Complete!"
echo "=========================================="
echo ""
echo "Admin Portal is now running!"
echo ""
echo "📍 Local access: http://localhost:3001"
echo "🌐 Public access: http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4):3001"
echo ""
echo "Useful commands:"
echo "  pm2 status          - Check application status"
echo "  pm2 logs            - View application logs"
echo "  pm2 restart admin-portal - Restart application"
echo "  pm2 stop admin-portal    - Stop application"
echo ""
echo "Database info:"
echo "  Database: sensor_db"
echo "  User: sensor_admin"
echo "  Connection: localhost:5432"
echo ""
echo "⚠️  Don't forget to:"
echo "  1. Open port 3001 in EC2 Security Group"
echo "  2. Or setup Nginx reverse proxy on port 80"
echo ""
