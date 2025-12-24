# Troubleshooting Payment Network Issues

This guide helps diagnose and resolve network connectivity issues when adding payment methods or loading wallet information in the BOUNTYExpo app.

## Common Error Messages

### "Connection timed out"
**Cause:** The app cannot reach the payment server within the allowed time (15 seconds).

**Solutions:**
1. Check your internet connection
2. Try switching between Wi-Fi and cellular data
3. Restart your app
4. If using a VPN, try disabling it temporarily

### "Unable to connect"
**Cause:** Network request failed completely - the app cannot establish a connection to the payment server.

**Solutions:**
1. Verify you're connected to the internet
2. Check if other apps can connect to the internet
3. Restart your device's network settings
4. Try connecting to a different Wi-Fi network

### "Payment service temporarily unavailable"
**Cause:** The payment server responded with an error.

**Solutions:**
1. Wait a few minutes and try again
2. Check the status page (if available)
3. Contact support if the issue persists

## Developer Troubleshooting

### For Development on Physical Devices

#### Issue: "Network request timed out" on physical iPhone/Android

**Diagnosis Steps:**

1. **Check API URL Resolution**
   - Open the Expo app and look for this log line:
     ```
     [API Config] Resolved API_BASE_URL: http://192.168.0.59:3001
     ```
   - If it shows `localhost` or `127.0.0.1`, the device cannot reach it

2. **Verify Network Configuration**
   ```bash
   # On Windows (PowerShell)
   ipconfig
   # Look for your IPv4 Address under your active network adapter
   
   # On Mac/Linux
   ifconfig
   # or
   ip addr show
   ```

3. **Test Server Reachability**
   ```bash
   # On Windows (PowerShell)
   Test-NetConnection -ComputerName 192.168.0.59 -Port 3001
   
   # On Mac/Linux
   nc -zv 192.168.0.59 3001
   # or
   telnet 192.168.0.59 3001
   ```

**Solutions:**

1. **Set the correct API URL**
   
   Create or update `.env` file in the root directory:
   ```env
   EXPO_PUBLIC_API_BASE_URL=http://YOUR_LOCAL_IP:3001
   ```
   
   Replace `YOUR_LOCAL_IP` with your machine's local IP address (e.g., `192.168.0.59`).

2. **Configure Firewall (Windows)**
   
   Open PowerShell as Administrator:
   ```powershell
   New-NetFirewallRule -DisplayName "Allow Node 3001" -Direction Inbound -LocalPort 3001 -Protocol TCP -Action Allow -Profile Any
   ```

3. **Configure Firewall (Mac)**
   
   - Open System Preferences → Security & Privacy → Firewall
   - Click "Firewall Options"
   - Add Node.js or your terminal app to allowed applications

4. **Use Expo Tunnel (Alternative)**
   
   If firewall configuration is not possible:
   ```bash
   npx expo start --tunnel
   ```
   
   This creates a public URL that works from any network.

5. **Use ngrok (Alternative)**
   
   ```bash
   # Install ngrok
   npm install -g ngrok
   
   # Start your payment server on port 3001
   npm run server
   
   # In another terminal, create tunnel
   ngrok http 3001
   
   # Copy the https URL and set it as EXPO_PUBLIC_API_BASE_URL
   ```

### Server Configuration Issues

#### Issue: Server only listening on localhost

**Check server binding:**

```javascript
// In server/index.js or similar
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
```

The second argument `'0.0.0.0'` makes the server accessible on all network interfaces, not just localhost.

#### Issue: Port already in use

**Find and kill the process:**

```bash
# Windows (PowerShell)
netstat -ano | findstr :3001
taskkill /PID <PID> /F

# Mac/Linux
lsof -i :3001
kill -9 <PID>
```

### Network Environment Issues

#### Corporate/Guest Wi-Fi Blocking

Some networks block device-to-device communication on the local network.

**Solutions:**
1. Use Expo Tunnel mode
2. Use ngrok
3. Use a mobile hotspot instead
4. Deploy to a staging server accessible from the internet

#### iOS Network Security

iOS requires HTTPS for network requests by default. For local development:

1. Add to `app.json` or `app.config.js`:
   ```json
   {
     "expo": {
       "ios": {
         "infoPlist": {
           "NSAppTransportSecurity": {
             "NSAllowsArbitraryLoads": true
           }
         }
       }
     }
   }
   ```

2. Rebuild the app for the changes to take effect.

## Monitoring Network Requests

### Enable Request Logging

Add this to your payment service to log all requests:

```javascript
// In your server file
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});
```

### Check Logs

Monitor server logs while triggering the payment method load:

```bash
# View real-time logs
tail -f api-requests.log

# Or if using pm2
pm2 logs
```

## Testing Connectivity

### Manual API Test

Test the payment methods endpoint directly:

```bash
# Replace with your actual URL and auth token
curl -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     http://192.168.0.59:3001/payments/methods
```

Expected response:
```json
{
  "paymentMethods": []
}
```

### Network Speed Test

Slow networks may cause timeouts. The app allows up to 15 seconds for payment method loading with automatic retry.

If your network is consistently slower:
1. Close background apps using bandwidth
2. Move closer to the Wi-Fi router
3. Restart your router
4. Contact your ISP if problems persist

## Still Having Issues?

1. **Clear app cache:**
   - Close the app completely
   - Clear Expo cache: `npx expo start -c`
   - Reopen the app

2. **Check app logs:**
   - Look for detailed error messages in the Expo console
   - Check for network-related errors in the browser console (if using web)

3. **Test with a different device:**
   - If it works on another device, the issue may be device-specific

4. **Contact Support:**
   - Provide the exact error message
   - Include your network configuration (Wi-Fi, cellular, VPN)
   - Note which screen/action triggers the error
   - Include server logs if you have access

## Related Documentation

- [ISSUE_PAYMENT_NETWORK.md](./ISSUE_PAYMENT_NETWORK.md) - Original issue documentation
- [STRIPE_INTEGRATION.md](./STRIPE_INTEGRATION.md) - Stripe payment integration guide
- [BACKEND_INTEGRATION.md](./BACKEND_INTEGRATION.md) - Backend API integration guide
