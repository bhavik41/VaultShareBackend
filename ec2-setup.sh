#!/bin/bash
# Run this script on a fresh Amazon Linux 2023 EC2 instance

# Update system
sudo yum update -y

# Install Node.js 20
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs

# Install git
sudo yum install -y git

# Install PM2 globally
sudo npm install -g pm2

# Clone the backend repo
cd /home/ec2-user
git clone https://github.com/bhavik41/VaultShareBackend.git
cd VaultShareBackend

# Switch to main branch
git checkout main

# Install dependencies
npm install

# Build TypeScript
npm run build

# Copy .env file (you must upload your .env manually or paste contents)
# scp -i your-key.pem .env ec2-user@<EC2-IP>:/home/ec2-user/VaultShareBackend/.env

# Start with PM2
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup systemd -u ec2-user --hp /home/ec2-user

echo "Backend is running on port 5001"
