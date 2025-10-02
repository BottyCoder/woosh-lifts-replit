# Admin UI Testing Guide

## Fixes Applied

### 1. Navigation Fixed ✅
- **Issue**: Navigation was broken due to missing `event` parameter
- **Fix**: Updated `navigateTo()` function to accept optional event parameter
- **Updated**: All onclick handlers now pass `event` correctly

### 2. Buttons Fixed ✅
- View All button now works correctly
- Save Lift button connected to `saveLift()` function
- Save Contact button connected to `saveContact()` function

## Testing Instructions

### Initial Setup
1. **Open the admin dashboard** at your Replit URL
2. **Enter Admin Token**: When prompted, enter your `ADMIN_TOKEN` value
   - The token is stored in localStorage for future visits
   - To reset: Clear browser localStorage or use incognito mode

### Test 1: Dashboard
**Expected:**
- [ ] Dashboard displays 4 stat cards (Active Tickets, Total Lifts, Messages Today, Total Contacts)
- [ ] Stats show numbers (not "-")
- [ ] Recent Tickets table shows sample tickets
- [ ] Status badge shows "Online" (green dot)
- [ ] View All button navigates to Tickets page

### Test 2: Navigation
**Test each nav item:**
- [ ] Click "Dashboard" - Dashboard page shows
- [ ] Click "Tickets" - Tickets page shows with full list
- [ ] Click "Messages" - Messages page shows with delivery status
- [ ] Click "Lifts" - Lifts page shows with list and form
- [ ] Click "Contacts" - Contacts page shows with list and form

**Expected:** Active nav item is highlighted in blue gradient

### Test 3: Lifts Page
**Test Add Lift:**
1. Fill in form:
   - MSISDN (Phone): 27123456789
   - Site Name: Test Building
   - Building: Block A
   - Notes: Test lift
2. Click "Save Lift"
3. **Expected**: Success message appears, form clears, list refreshes with new lift

**Test List:**
- [ ] Existing lifts display in table
- [ ] Columns show: MSISDN, Site Name, Building, Notes, Created date

### Test 4: Contacts Page
**Test Add Contact:**
1. Fill in form:
   - Display Name: Test Contact
   - Phone (MSISDN): 27987654321
   - Email: test@example.com
   - Role: Building Manager
2. Click "Save Contact"
3. **Expected**: Success message appears, form clears, list refreshes

**Test List:**
- [ ] Existing contacts display in table
- [ ] Columns show: Name, Phone, Email, Role, Created date

### Test 5: Tickets Page
**Expected:**
- [ ] All tickets display (not just open ones)
- [ ] Status badges show colors:
  - Open (blue)
  - Entrapment Awaiting Confirmation (yellow)
  - Resolved (green)
  - Auto Closed (gray/red)
- [ ] Button badges show: Test, Maintenance, Entrapment, YES
- [ ] Timestamps format correctly (e.g., "2h ago", "Just now")

### Test 6: Messages Page
**Expected:**
- [ ] Messages display with direction (Inbound/Outbound)
- [ ] Delivery status icons show:
  - ✓ Sent
  - ✓✓ Delivered (gray checkmarks)
  - ✓✓ Read (blue checkmarks)
  - ✗ Failed (red X)
- [ ] Message body text displays
- [ ] Timestamps show correctly

## Known Issues / Expected Behavior

### Data Loading
- First page load may take 2-3 seconds
- Cached responses return faster (304 status)
- Auto-refresh every 30 seconds on Dashboard

### Authentication
- Invalid token shows "Authentication failed" alert
- Must enter correct ADMIN_TOKEN from environment
- Token stored in browser localStorage

### Sample Data
The system has these test records:
- 5 lifts
- 6 contacts
- 5 tickets (1 open, 2 resolved, 1 entrapment, 1 auto-closed)
- 7 messages (various delivery statuses)

## Troubleshooting

### Dashboard shows "-" for all stats
**Cause**: Admin token not accepted or not entered
**Solution**: 
1. Open browser console (F12)
2. Clear localStorage: `localStorage.clear()`
3. Refresh page
4. Enter correct ADMIN_TOKEN when prompted

### Navigation doesn't work
**Cause**: JavaScript error (should be fixed)
**Solution**: Check browser console for errors

### Forms don't save
**Cause**: Missing required fields or auth issue
**Check**:
1. All required fields filled
2. Admin token is valid
3. Check browser console for errors

### Status badge stuck on "Checking..."
**Cause**: API not responding or auth issue
**Check**:
1. Server is running (check workflow)
2. Database is connected
3. Admin token is correct

## API Testing (For Debugging)

Test endpoints directly with curl:

```bash
# Get lifts
curl -H "X-Admin-Token: YOUR_TOKEN" http://localhost:5000/admin/lifts

# Get contacts
curl -H "X-Admin-Token: YOUR_TOKEN" http://localhost:5000/admin/contacts

# Get tickets
curl -H "X-Admin-Token: YOUR_TOKEN" http://localhost:5000/admin/tickets

# Get messages
curl -H "X-Admin-Token: YOUR_TOKEN" http://localhost:5000/admin/messages
```

All endpoints should return:
```json
{
  "ok": true,
  "data": [...]
}
```

## Success Criteria

✅ **All Tests Pass** = Admin UI is fully functional

The admin UI should allow you to:
1. View dashboard with real-time stats
2. Navigate between all pages
3. View all tickets with status tracking
4. View all messages with delivery status
5. Add/edit lifts
6. Add/edit contacts
7. See recent activity updates
