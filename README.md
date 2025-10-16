# 🎯 AsanaToSheetV2 - Modular Implementation Guide

## 📁 File Structure Overview

```
AsanaToSheetV2 Project
├── AsanaToSheetV2_Endpoints.gs      [API Layer - Web Handler]
├── AsanaToSheetV2_Core.gs           [Infrastructure - Config & Cache]
├── AsanaToSheetV2_Sync.gs           [Asana Integration]
├── AsanaToSheetV2_Analysis.gs       [Workload Analysis]
├── AsanaToSheetV2_Settings.gs       [Settings Management]
└── AsanaToSheetV2_UI.gs             [Menu & Automation]
```

---

## 📋 File Descriptions

### 1. **AsanaToSheetV2_Endpoints.gs** (API Layer)
**วัตถุประสงค์**: HTTP requests handler
- `doGet()` / `doPost()` - Web entry points
- `handleApiRequest_()` - Unified router (V1 + V2 endpoints)
- Endpoint handlers for each API action
- AUTH guards (LINE, API Key)
- JSONP support

**ไม่มี dependency** - เรียกใช้ฟังชั่นจากไฟล์อื่นได้

**Key Functions**:
- `handleApiRequest_()` - Main dispatcher
- `handleSyncRecentEndpoint_()`
- `handleWorkloadRiskEndpoint_()`

---

### 2. **AsanaToSheetV2_Core.gs** (Infrastructure)
**วัตถุประสงค์**: Global config + utilities หลัก
- Global config (CFG)
- Sheet names & headers
- Cache management
- Task loading from sheet
- Users lookup
- Task filtering & summary
- V1 compatibility functions (getUserStats_, getUpcomingTasks_)

**Imports**: ไม่ต้อง import ใคร (ได้ฟังชั่นพื้นฐาน)

**Key Variables**:
```javascript
CFG = {
  SHEET_ID,
  API_KEY,
  ASANA_ACCESS_TOKEN,
  ASANA_PROJECT_ID
}

SHEETS = {
  TASKS, USERS, WORKLOAD_RISK, WORKLOAD_PERIOD,
  WORKLOAD_SETTINGS, TIMELINESS_SETTINGS, WORKLOAD_RISK_SETTINGS
}
```

---

### 3. **AsanaToSheetV2_Sync.gs** (Asana Integration)
**วัตถุประสงค์**: ซิงก์งานจาก Asana API
- HTTP requests to Asana (`asanaRequest_()`, `fetchAsanaJson_()`)
- Fetch tasks (recent / all)
- Incremental sync with diff detection
- Task mapping & conversion
- V1 compatibility (create/update task)

**Requires**: AsanaToSheetV2_Core.gs

**Key Functions**:
- `syncAsanaToSheet_FilteredByUsers_()` - Main sync
- `fetchAsanaTasksRecent_(recentDays)`
- `fetchAsanaTasksAll_()`
- `mapAsanaTask_()`
- `updateTaskStatus_V1_Compat_()`

---

### 4. **AsanaToSheetV2_Analysis.gs** (Workload Analysis)
**วัตถุประสงค์**: วิเคราะห์ภาระงาน + ความเสี่ยง
- Period range calculations (day/week/month/term/AY/salary)
- Timeliness score computation
- Workload analysis by user & period
- Multi-window risk assessment
- Output to sheets (Workload, WorkloadPeriod)

**Requires**: AsanaToSheetV2_Core.gs, AsanaToSheetV2_Sync.gs

**Key Functions**:
- `getPeriodRange_(opt)` - Calculate date range
- `analyzeWorkloadByUser_(opt)` - Single period analysis
- `analyzeWorkloadRisk_()` - Multi-window + risk
- `computeTimelinessScore_()` - Score calculation
- `upsertWorkloadRiskSheet_()`

---

### 5. **AsanaToSheetV2_Settings.gs** (Settings Management)
**วัตถุประสงค์**: ตั้งค่า + category classification
- Timeliness settings sheet
- Workload category settings
- Risk threshold settings
- Category auto-classification

**Requires**: AsanaToSheetV2_Core.gs

**Key Functions**:
- `getTimelinessSettings_()` - ดึงคะแนน
- `getWorkloadSettings_()` - ดึงหมวด + keyword
- `getWorkloadRiskSettings_()` - ดึงเกณฑ์
- `classifyCategoryFromNameWithRole_()` - Auto classify

---

### 6. **AsanaToSheetV2_UI.gs** (Menu & Automation)
**วัตถุประสงค์**: UI + automation triggers
- Custom menu (`onOpen()`)
- Manual menu actions
- Daily automation triggers
- Progress dialogs

**Requires**: ทุกไฟล์อื่น

**Key Functions**:
- `onOpen()` - Create menu
- `menuSyncRecentFast()`
- `menuAnalyzeWorkloadRisk()`
- `installDailySyncAndAnalyzeTriggers_()`
- `dailySyncAndAnalyze()` - Auto trigger

---

## 🚀 Installation Steps

### Step 1: Create Google Sheet
1. Create new Google Sheet
2. Note the Sheet ID: `https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit`
3. Share with service account / users

### Step 2: Create Apps Script Project
1. Go to Sheet → Extensions → Apps Script
2. Delete default `Code.gs`
3. Create 6 new files with names from file structure

### Step 3: Add Code to Each File
Copy-paste code from each artifact into corresponding `.gs` file:
1. AsanaToSheetV2_Endpoints.gs
2. AsanaToSheetV2_Core.gs
3. AsanaToSheetV2_Sync.gs
4. AsanaToSheetV2_Analysis.gs
5. AsanaToSheetV2_Settings.gs
6. AsanaToSheetV2_UI.gs

### Step 4: Configure Script Properties
Go to Project Settings → Script Properties:

```
SHEET_ID             → Your Google Sheet ID
API_KEY              → Your secret API key (optional)
LINE_CHANNEL_ID      → Your LINE channel ID (for LINE Login)
REQUIRE_LINE_LOGIN   → true/false
ASANA_ACCESS_TOKEN   → Your Asana Personal Access Token
ASANA_PROJECT_ID     → Your Asana Project ID
ASANA_WORKSPACE_ID   → Your Asana Workspace ID (optional)
```

### Step 5: Deploy Web App
1. Click "Deploy" → "New Deployment"
2. Type: "Web app"
3. Execute as: Your account
4. Who has access: "Anyone"
5. Copy deployment URL

### Step 6: Create Users Sheet
Create a sheet called "Users" with columns:
```
User          Name       Status    Level        LINE UID
email@test.com John Doe  Active    teacher      U1234567890
```

### Step 7: Refresh Sheet
- F5 or reload page
- Should see "KruBoard" menu

---

## 📱 API Endpoints

### V2 Endpoints (NEW)

```bash
# Sync recent 14 days
GET /macros/d/{DEPLOYMENT_ID}/usercontent/do?action=sync_asana_recent&days=14&key=YOUR_API_KEY

# Sync all
GET /macros/d/{DEPLOYMENT_ID}/usercontent/do?action=sync_asana_all&key=YOUR_API_KEY

# Analyze workload (current month)
GET /macros/d/{DEPLOYMENT_ID}/usercontent/do?action=workload_analyze_period&mode=month&key=YOUR_API_KEY

# Analyze workload risk
GET /macros/d/{DEPLOYMENT_ID}/usercontent/do?action=workload_analyze_risk&key=YOUR_API_KEY
```

### V1 Endpoints (Backward Compatible)

```bash
# Dashboard
GET /macros/d/{DEPLOYMENT_ID}/usercontent/do?action=dashboard&idToken=LINE_TOKEN

# Upcoming tasks
GET /macros/d/{DEPLOYMENT_ID}/usercontent/do?action=upcoming&days=7&idToken=LINE_TOKEN

# User stats
GET /macros/d/{DEPLOYMENT_ID}/usercontent/do?action=user_stats&idToken=LINE_TOKEN

# Update task status
POST /macros/d/{DEPLOYMENT_ID}/usercontent/do
{
  "action": "update_status",
  "taskId": "WD12345",
  "status": "เสร็จสมบูรณ์",
  "idToken": "LINE_TOKEN"
}
```

---

## 🎛️ Features & Menu

### Menu Items
1. **ซิงก์ Asana (ล่าสุด 14 วัน)** - Quick sync
2. **ซิงก์ Asana (ทั้งหมด)** - Full sync
3. **วิเคราะห์ภาระงาน (รายช่วง)** - Analyze period
4. **วิเคราะห์หลายช่วง + ความเสี่ยง** - Multi-window risk
5. **เปิดตั้งค่า Workload** - Edit categories
6. **เปิดตั้งค่า Timeliness** - Edit scores
7. **เปิดตั้งค่า Workload Risk** - Edit thresholds
8. **ติด Trigger รายวัน** - Install automation
9. **ล้างแคช** - Clear cache

### Auto Triggers
- **06:10 AM** - Sync + Analyze
- **18:10 PM** - Sync + Analyze

---

## ⚙️ Configuration

### WorkloadSettings
```
Category      Weight  Keywords_Teacher           Keywords_Assistant      Keywords_Director
งานสอน        1.8     สอน,แผนการสอน,...         ช่วยสอน,เตรียมสื่อ,...  ชั่วโมงสอน,...
ประชุม        0.8     ประชุม,PLC,อบรม,...       ประชุม,บันทึก,...      ประชุมผู้บริหาร,...
กิจกรรม       1.2     กิจกรรม,ลูกเสือ,...       ช่วยกิจกรรม,...        พิธีการ,...
วิชาการ       2.0     หลักสูตร,วิจัย,...        ช่วยวิจัย,...          หลักสูตรสถานศึกษา,...
โครงการ       1.5     โครงการ,นวัตกรรม,...     ช่วยดำเนินโครงการ,...  โครงการสถานศึกษา,...
บริหาร        2.2     เอกสาร,ประสานงาน,...     สนับสนุนเอกสาร,...     บริหาร,นโยบาย,...
```

### TimelinessSettings
```
Early3Days: +5  (เสร็จก่อน 3 วัน)
Early1to2:  +3  (เสร็จ 1-2 วันก่อน)
OnTime:     +2  (เสร็จตรงเวลา)
Late1to3:   -2  (ล่าช้า 1-3 วัน)
LateOver3:  -5  (ล่าช้ามากกว่า 3 วัน)
Incomplete: -3  (ยังไม่เสร็จ)
```

### WorkloadRiskSettings
```
NormalMax:      6    (ปกติ ≤ 6)
WatchMax:       10   (เฝ้าระวัง ≤ 10)
HighMax:        15   (เสี่ยงสูง ≤ 15)
AY Period:      5-3  (May-March Thai)
Salary P1:      10/1-3/31
Salary P2:      4/1-9/30
```

---

## 🔄 Data Flow

```
Asana API
    ↓
fetchAsanaTasksRecent_() / fetchAsanaTasksAll_()
    ↓
syncAsanaToSheet_FilteredByUsers_()
    ↓
writeTasksToSheet_Incremental_()
    ↓
AsanaToSheet (Sheet)
    ↓
analyzeWorkloadByUser_() / analyzeWorkloadRisk_()
    ↓
upsertWorkloadRiskSheet_() / upsertWorkloadByCount_()
    ↓
Workload (Sheet) / WorkloadPeriod (Sheet)
```

---

## 📊 Output Sheets

### AsanaToSheet
Main task list synced from Asana:
```
Task GID | Name | Assignee | Due Date | Completed | Category | Weight | Score | Status
```

### Workload
Multi-window summary + risk:
```
Assignee | Total Tasks | Total Score | Week Score | Workload Risk | Risk Note
```

### WorkloadPeriod
Period-specific analysis:
```
Assignee | Total Tasks | By Category | Completion Rate
```

---

## 🐛 Troubleshooting

### Sync not working
1. Check ASANA_ACCESS_TOKEN in Script Properties
2. Check ASANA_PROJECT_ID valid
3. Look at Execution logs: Extensions → Apps Script

### Category not auto-classified
1. Edit keywords in WorkloadSettings sheet
2. Make sure Status = "Active" in Users sheet
3. Make sure Level field matches: teacher/assistant/director

### Triggers not running
1. Menu → Install Triggers
2. Check quota: Extensions → Apps Script → Executions

### Sheet not loading
1. Refresh browser
2. Check SHEET_ID is correct
3. Verify you have edit permission

---

## 📝 Notes

- **V1 Backward Compatible**: All old endpoints still work
- **Modular Design**: Can add/edit one file without affecting others
- **Incremental Sync**: Only updates changed tasks (faster)
- **Active User Filter**: Only syncs tasks assigned to "Active" users
- **Automatic Classification**: Auto-tags categories based on keywords
- **Risk Based on Weekly Score**: Uses this week's workload to assess risk

---

## 🔗 Related Documentation

- [Asana API Docs](https://developers.asana.com/)
- [Apps Script Documentation](https://developers.google.com/apps-script)
- [LINE Login Documentation](https://developers.line.biz/en/documentation/line-login/)
