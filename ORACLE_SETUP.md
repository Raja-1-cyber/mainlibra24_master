# Oracle Cloud Setup — Libra 24

Alag Oracle folder ki zarurat nahi. Same GitHub repo clone karke VM pe chalega.

## 1. Create Always Free VM
1. https://cloud.oracle.com → Login
2. **Compute → Instances → Create Instance**
3. Image: **Ubuntu 22.04**
4. Shape: Always Free (ARM `VM.Standard.A1.Flex` 1 OCPU / 6GB preferred)
5. Assign **public IP** = Yes
6. Add your SSH public key
7. Create

## 2. Open port 3000
1. Instance → VCN → **Security List**
2. **Add Ingress Rule**
   - Source: `0.0.0.0/0`
   - Protocol: TCP
   - Destination port: **3000**

## 3. SSH
```bash
ssh -i your-key.key ubuntu@YOUR_PUBLIC_IP
```

## 4. Install Node.js
```bash
sudo apt update
sudo apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
```

## 5. Clone this repo
```bash
cd ~
git clone https://github.com/Raja-1-cyber/mainlibra24_master.git
cd mainlibra24_master
npm install
```

## 6. Permanent data folder (IDs/coins)
```bash
mkdir -p /home/ubuntu/libra-data
```

## 7. Run with PM2
```bash
sudo npm i -g pm2
DATA_DIR=/home/ubuntu/libra-data PORT=3000 HOST=0.0.0.0 pm2 start server.js --name libra24
pm2 save
pm2 startup
```
Follow the command `pm2 startup` prints.

## 8. Open site
```
http://YOUR_PUBLIC_IP:3000
```
Login: **master** / **master123**

## Later updates
```bash
cd ~/mainlibra24_master
git pull
npm install
pm2 restart libra24
```

## Notes
- `server.js` already supports `DATA_DIR` and binds `0.0.0.0`
- No special Oracle folder needed in the repo
- Users/coins save in `/home/ubuntu/libra-data` (survives restarts)
