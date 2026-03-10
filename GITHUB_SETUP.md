# GitHub Repository Setup Guide

## Step 1: Initialize Git Repository (Local)

```bash
cd admin-portal-v2

# Initialize git
git init

# Add all files
git add .

# Create first commit
git commit -m "Initial commit: Admin portal with dashboard, devices, and users management"
```

## Step 2: Create GitHub Repository

1. Go to https://github.com/new
2. Repository name: `sensor-admin-portal` (or your preferred name)
3. Description: `Admin portal for Raspberry Pi sensor management`
4. Choose: **Public** or **Private**
5. **DO NOT** initialize with README (we already have one)
6. Click **Create repository**

## Step 3: Push to GitHub

After creating the repo, GitHub will show you commands. Use these:

```bash
# Add remote origin (replace USERNAME with your GitHub username)
git remote add origin https://github.com/USERNAME/sensor-admin-portal.git

# Push to GitHub
git branch -M main
git push -u origin main
```

## Step 4: Verify Upload

Visit your repository URL:
`https://github.com/USERNAME/sensor-admin-portal`

You should see:
- ✅ package.json
- ✅ server.js
- ✅ public/index.html
- ✅ database-schema.sql
- ✅ README.md
- ✅ .gitignore
- ❌ .env (correctly excluded)
- ❌ node_modules/ (correctly excluded)

## Step 5: Deploy to EC2

Once pushed to GitHub, deploy on EC2:

```bash
# SSH to EC2
ssh -i your-key.pem ec2-user@your-ec2-ip

# Clone from GitHub
cd ~
git clone https://github.com/USERNAME/sensor-admin-portal.git
cd sensor-admin-portal

# Install Node.js (if not installed)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install --lts

# Install dependencies
npm install

# Setup environment
cp .env.example .env
nano .env

# Setup database
sudo systemctl start postgresql
psql -U postgres -d sensor_db -f database-schema.sql

# Run with PM2
npm install -g pm2
pm2 start server.js --name admin-portal
pm2 save
pm2 startup
```

## Future Updates

To update the code on EC2 after pushing changes to GitHub:

```bash
cd ~/sensor-admin-portal
git pull origin main
pm2 restart admin-portal
```

## Troubleshooting

### Authentication Error
If GitHub asks for credentials:

**Option 1: Use Personal Access Token**
1. Go to GitHub → Settings → Developer settings → Personal access tokens
2. Generate new token (classic)
3. Select scopes: `repo` (all)
4. Copy the token
5. Use token as password when pushing

**Option 2: Use SSH**
```bash
# Generate SSH key
ssh-keygen -t ed25519 -C "your_email@example.com"

# Copy public key
cat ~/.ssh/id_ed25519.pub

# Add to GitHub → Settings → SSH and GPG keys → New SSH key

# Change remote URL
git remote set-url origin git@github.com:USERNAME/sensor-admin-portal.git
```

## Repository Best Practices

✅ **Do commit:**
- Source code
- README and documentation
- .gitignore
- .env.example (template without secrets)

❌ **Don't commit:**
- node_modules/
- .env (contains secrets)
- Database files
- Log files
- IDE-specific files
