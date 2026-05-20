// Employee Data Library Phase 2: Master Library UI & On-Demand Fetching

const HR_LIBRARY_COMPLIANCE = {
  sa_citizen:   { label:"SA Citizen",            icon:"🇿🇦", color:"#14532d", bg:"#dcfce7", border:"#86efac" },
  work_permit:  { label:"Valid Work Permit",      icon:"✅",  color:"#8E5570", bg:"#dbeafe", border:"#93c5fd" },
  asylum:       { label:"Asylum on File",         icon:"📋",  color:"#4c1d95", bg:"#ede9fe", border:"#a78bfa" },
  verified_dha: { label:"Verified by DHA",        icon:"🔵",  color:"#0c4a6e", bg:"#e0f2fe", border:"#7dd3fc" },
  z_na:         { label:"Z/NA – No Valid Permit", icon:"🚨",  color:"#831843", bg:"#fee2e2", border:"#fca5a5" },
};

const EmployeeDataLibrary = ({ staff = [], currentUser, managers = [], obList = [], offList = [] }) => {
  const { useState, useEffect, useMemo } = React;

  // Google API State
  const [token, setToken] = useState(null);
  const [error, setError] = useState(null);

  // Library UI State
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [selectedFolder, setSelectedFolder] = useState(null); // null, 'active', 'archive', 'trial'

  // Sheet Data State
  const [sheetMetadata, setSheetMetadata] = useState(null);
  const [sheetValues, setSheetValues] = useState(null);
  const [loading, setLoading] = useState(false);

  // Document Fetching State
  const [employeeDocs, setEmployeeDocs] = useState(null);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [topLevelFolders, setTopLevelFolders] = useState(null);
  const [subfolderCache, setSubfolderCache] = useState({});

  // 1. Active Staff List (Currently active staff members from the database)
  const activeEmployees = useMemo(() => {
    const allStaff = [...staff, ...managers];
    return allStaff
      .filter(e => e.active === true)
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [staff, managers]);

  // 2. Archive Staff List (From consolidated inactive database records + offList leavers fallback)
  const archiveEmployees = useMemo(() => {
    const allStaff = [...staff, ...managers];
    const inactiveStaff = allStaff.filter(e => e.active === false);
    
    // Fallback: merge any offList leavers that might not be in the database yet
    const archiveList = [...inactiveStaff];
    offList.forEach(o => {
      if (o.ec && !archiveList.some(a => a.ec && a.ec.trim() === o.ec.trim())) {
        archiveList.push({
          ...o,
          role: o.reason ? `Archived (${o.reason})` : "Left / Archived",
          isArchived: true,
          active: false
        });
      }
    });
    return archiveList.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [staff, managers, offList]);

  // 3. Trial Staff List (From obList onboarding records)
  const trialEmployees = useMemo(() => {
    return [...obList]
      .map(o => ({
        ...o,
        role: o.status || "Trial Staff",
        isTrial: true
      }))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [obList]);

  // Determine which list is in the opened folder
  const currentFolderEmployees = useMemo(() => {
    if (selectedFolder === "active") return activeEmployees;
    if (selectedFolder === "archive") return archiveEmployees;
    if (selectedFolder === "trial") return trialEmployees;
    return [];
  }, [selectedFolder, activeEmployees, archiveEmployees, trialEmployees]);

  // Filter based on search query inside the opened folder
  const filteredEmployees = useMemo(() => {
    if (!selectedFolder) return [];
    if (!searchQuery) return currentFolderEmployees;
    const lowerQ = searchQuery.toLowerCase();
    return currentFolderEmployees.filter(e =>
      (e.name && e.name.toLowerCase().includes(lowerQ)) ||
      (e.ec && e.ec.toLowerCase().includes(lowerQ)) ||
      (e.branch && e.branch.toLowerCase().includes(lowerQ)) ||
      (e.role && e.role.toLowerCase().includes(lowerQ)) ||
      (e.position && e.position.toLowerCase().includes(lowerQ))
    );
  }, [currentFolderEmployees, searchQuery, selectedFolder]);

  // Authenticate with Google to obtain an Access Token
  const handleAuthClick = () => {
    if (!window.google) {
      setError("Google API not loaded yet. Please wait a moment and try again.");
      return;
    }

    try {
      setError(null);
      const client = google.accounts.oauth2.initTokenClient({
        client_id: window.BOA_GOOGLE_CONFIG.clientId,
        scope: "https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.readonly",
        callback: (tokenResponse) => {
          if (tokenResponse && tokenResponse.access_token) {
            setToken(tokenResponse.access_token);
            if (window.gapi && gapi.client) {
              gapi.client.setToken({ access_token: tokenResponse.access_token });
            }
          } else {
            setError("Failed to authenticate with Google.");
          }
        },
      });
      client.requestAccessToken();
    } catch (err) {
      console.error(err);
      setError("Error initializing Google Identity Client: " + err.message);
    }
  };

  // Fetch and cache Sheet Data
  const fetchSheetData = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch Metadata
      const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${window.BOA_GOOGLE_CONFIG.sheetId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const metaData = await metaRes.json();
      if (metaData.error) throw new Error(metaData.error.message);
      setSheetMetadata(metaData);

      // 2. Fetch Values for all tabs (Columns A to AM to cover 31 days)
      const ranges = metaData.sheets.map(s => encodeURIComponent(`${s.properties.title}!A:AM`)).join('&ranges=');
      const dataRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${window.BOA_GOOGLE_CONFIG.sheetId}/values:batchGet?ranges=${ranges}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const dataVals = await dataRes.json();
      if (dataVals.error) throw new Error(dataVals.error.message);

      setSheetValues(dataVals.valueRanges);
    } catch (err) {
      setError("Error fetching sheet data: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Fetch documents specifically for the selected employee
  const fetchEmployeeDocuments = async (employee) => {
    if (!token) {
      handleAuthClick();
      return;
    }
    setLoadingDocs(true);
    setError(null);
    setEmployeeDocs(null);

    try {
      let folders = [];
      let categories = topLevelFolders;
      
      // 1. Fetch the top-level category folders (e.g., the 6 main folders) if not cached
      if (!categories) {
          const q = `'${window.BOA_GOOGLE_CONFIG.folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
          const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&includeItemsFromAllDrives=true&supportsAllDrives=true`;
          const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
          const data = await res.json();
          if (data.error) throw new Error(data.error.message);
          categories = data.files || [];
          setTopLevelFolders(categories);
      }

      const ec = employee.ec ? employee.ec.trim().toLowerCase() : "";
      const fName = employee.firstName ? employee.firstName.trim().toLowerCase() : "";
      const sName = employee.surname ? employee.surname.trim().toLowerCase() : "";
      
      let foundFolder = null;
      let newCache = { ...subfolderCache };

      // 2. Iterate through the top-level folders one by one (1 child search at a time)
      for (const category of categories) {
          let categoryChildren = newCache[category.id];
          
          if (!categoryChildren) {
              // Fetch all employee folders inside this specific category folder
              categoryChildren = [];
              let pageToken = "";
              do {
                  const childQ = `'${category.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
                  const childUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(childQ)}&fields=nextPageToken,files(id,name)&includeItemsFromAllDrives=true&supportsAllDrives=true` + (pageToken ? `&pageToken=${pageToken}` : '');
                  
                  const res = await fetch(childUrl, { headers: { Authorization: `Bearer ${token}` } });
                  const data = await res.json();
                  if (data.error) throw new Error(data.error.message);
                  
                  if (data.files) categoryChildren.push(...data.files);
                  pageToken = data.nextPageToken;
              } while (pageToken);
              
              // Cache it so we don't fetch this category again
              newCache[category.id] = categoryChildren;
          }
          
          // 3. Robust Scoring Algorithm (Bypasses Google API quirks, guarantees maximum accuracy)
          let bestMatch = null;
          let bestScore = 0;

          for (const f of categoryChildren) {
              const rawFn = f.name.toLowerCase();
              let score = 0;
              
              // Normalize strings by replacing hyphens/underscores with spaces for robust name matching
              const cleanStr = (str) => (str || "").replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
              const cleanFn = cleanStr(rawFn);
              const cleanF = cleanStr(fName);
              const cleanS = cleanStr(sName);
              const cleanFullName = `${cleanF} ${cleanS}`.trim();

              const hasEc = ec && rawFn.includes(ec);
              const hasExactName = cleanFullName && cleanFn.includes(cleanFullName);
              const hasFirstName = cleanF && cleanFn.includes(cleanF);
              const hasSurname = cleanS && cleanFn.includes(cleanS);

              if (hasEc && hasExactName) {
                  score = 100; // Perfect match (EC + Full Name)
              } else if (hasEc && (hasFirstName || hasSurname)) {
                  score = 80;  // EC matches + at least one name matches
              } else if (hasExactName) {
                  score = 70;  // Missing EC, but exact full name matches (e.g., "Justin Rule_OM_Payroll")
              } else if (hasEc) {
                  score = 50;  // ONLY EC matches. Risky if EC was recycled, but accepted if no better match exists.
              } else if (hasFirstName && hasSurname) {
                  score = 40;  // Both names appear but separated
              }

              if (score > bestScore) {
                  bestScore = score;
                  bestMatch = f;
              }
          }
          
          if (bestScore > 0 && bestMatch) {
              foundFolder = bestMatch;
          }
          
          // If we found the employee folder in this category, STOP searching!
          if (foundFolder) {
              break;
          }
      }
      
      setSubfolderCache(newCache); // Update the cache

      if (foundFolder) {
          folders = [foundFolder];
      }

      if (folders.length === 0) {
        setEmployeeDocs({ foldersFound: 0, files: [] });
        return;
      }

      // 4. Fetch files inside the found folder(s)
      const allFiles = [];
      for (const folder of folders) {
        let pageToken = "";
        do {
          const fileQuery = `'${folder.id}' in parents and trashed = false`;
          const fileUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(fileQuery)}&fields=nextPageToken,files(id,name,mimeType,createdTime,webViewLink,iconLink)&includeItemsFromAllDrives=true&supportsAllDrives=true` + (pageToken ? `&pageToken=${pageToken}` : '');

          const fileRes = await fetch(fileUrl, { headers: { Authorization: `Bearer ${token}` } });
          const fileData = await fileRes.json();
          if (fileData.error) throw new Error(fileData.error.message);

          for (const f of (fileData.files || [])) {
            // Only add actual files, skip nested folders inside the employee folder to keep it flat
            if (f.mimeType !== 'application/vnd.google-apps.folder') {
              allFiles.push({ ...f, folderName: folder.name });
            }
          }
          pageToken = fileData.nextPageToken;
        } while (pageToken);
      }

      setEmployeeDocs({ foldersFound: folders.length, files: allFiles });

    } catch (err) {
      setError("Error fetching documents: " + err.message);
    } finally {
      setLoadingDocs(false);
    }
  };

  // Compute Historical Ledger from cached Sheet Values
  const employeeLedger = useMemo(() => {
    if (!selectedEmployee || !sheetValues) return null;
    const ec = selectedEmployee.ec;
    const name = selectedEmployee.name;
    const rawRecords = [];

    // 1. Extract raw chronological records
    sheetValues.forEach(tab => {
      const rows = tab.values;
      if (!rows || rows.length < 2) return;

      const headerRow = rows[0]; // Row 1 has dates from E onwards (index 4)
      const tabMonth = tab.range.split('!')[0].replace(/'/g, '');

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;

        const rowEc = row[1];   // Column B
        const rowName = row[2]; // Column C

        const isMatch = (ec && rowEc === ec) || (name && rowName && rowName.toLowerCase() === name.toLowerCase());

        if (isMatch) {
          for (let c = 4; c < Math.min(row.length, headerRow.length); c++) {
            const dateStr = headerRow[c];
            const val = row[c];
            if (dateStr && val && val.trim() !== "") {
              const dateObj = new Date(dateStr);
              if (!isNaN(dateObj.getTime())) {
                rawRecords.push({
                  dateStr: dateStr,
                  dateObj: dateObj,
                  value: val.trim(),
                  month: tabMonth
                });
              }
            }
          }
        }
      }
    });

    // Sort chronologically ascending to group continuous days properly
    rawRecords.sort((a, b) => a.dateObj - b.dateObj);

    // 2. Parse into specific timelines
    const timelineEvents = [];
    let currentLeave = null;
    let currentMaternity = null;
    const lateTally = {}; // { "April 2026": count }

    const pushLeave = () => {
      if (currentLeave) {
        timelineEvents.push({
          title: `Annual Leave Taken`,
          subtitle: `${currentLeave.count} days: ${currentLeave.startDate} to ${currentLeave.endDate}`,
          dateObj: currentLeave.startObj,
          isIncident: false,
          icon: "🌴"
        });
        currentLeave = null;
      }
    };

    const pushMaternity = () => {
      if (currentMaternity) {
        timelineEvents.push({
          title: `Maternity Leave`,
          subtitle: `${currentMaternity.count} days: ${currentMaternity.startDate} to ${currentMaternity.endDate}`,
          dateObj: currentMaternity.startObj,
          isIncident: false,
          icon: "🤱"
        });
        currentMaternity = null;
      }
    };

    for (const rec of rawRecords) {
      const valLower = rec.value.toLowerCase();

      // Handle Lates (Tally)
      if (valLower.includes("late")) {
        lateTally[rec.month] = (lateTally[rec.month] || 0) + 1;
      }

      // Handle Sick
      if (valLower.includes("sick")) {
        timelineEvents.push({
          title: `Sick Instance`,
          subtitle: `${rec.dateStr} — ${rec.value}`,
          dateObj: rec.dateObj,
          isIncident: true,
          icon: "🤒"
        });
      }

      // Handle No Show
      if (valLower.includes("no show") || valLower.includes("noshow") || valLower.includes("awol")) {
        timelineEvents.push({
          title: `No Show / AWOL`,
          subtitle: `${rec.dateStr} — ${rec.value}`,
          dateObj: rec.dateObj,
          isIncident: true,
          icon: "🚨"
        });
      }

      // Handle Leave Blocks
      if (valLower.includes("leave") && !valLower.includes("maternity") && !valLower.includes("sick")) {
        if (!currentLeave) {
          currentLeave = { startObj: rec.dateObj, startDate: rec.dateStr, endDate: rec.dateStr, count: 1, lastDateObj: rec.dateObj };
        } else {
          const diffDays = Math.round((rec.dateObj - currentLeave.lastDateObj) / (1000 * 60 * 60 * 24));
          if (diffDays <= 4) { // Allow for weekends
            currentLeave.endDate = rec.dateStr;
            currentLeave.count++;
            currentLeave.lastDateObj = rec.dateObj;
          } else {
            pushLeave();
            currentLeave = { startObj: rec.dateObj, startDate: rec.dateStr, endDate: rec.dateStr, count: 1, lastDateObj: rec.dateObj };
          }
        }
      } else {
        pushLeave();
      }

      // Handle Maternity Blocks
      if (valLower.includes("maternity")) {
        if (!currentMaternity) {
          currentMaternity = { startObj: rec.dateObj, startDate: rec.dateStr, endDate: rec.dateStr, count: 1, lastDateObj: rec.dateObj };
        } else {
          const diffDays = Math.round((rec.dateObj - currentMaternity.lastDateObj) / (1000 * 60 * 60 * 24));
          if (diffDays <= 4) {
            currentMaternity.endDate = rec.dateStr;
            currentMaternity.count++;
            currentMaternity.lastDateObj = rec.dateObj;
          } else {
            pushMaternity();
            currentMaternity = { startObj: rec.dateObj, startDate: rec.dateStr, endDate: rec.dateStr, count: 1, lastDateObj: rec.dateObj };
          }
        }
      } else {
        pushMaternity();
      }
    }

    pushLeave();
    pushMaternity();

    // Add Late Tallies
    for (const [month, count] of Object.entries(lateTally)) {
      if (count > 0) {
        const mockDate = new Date(`1 ${month}`);
        timelineEvents.push({
          title: `Late Instances`,
          subtitle: `Late ${count} time(s) during the ${month} pay period.`,
          dateObj: isNaN(mockDate) ? new Date() : mockDate,
          isIncident: true,
          icon: "⏰"
        });
      }
    }

    // Sort final timeline descending
    return timelineEvents.sort((a, b) => b.dateObj - a.dateObj);
  }, [selectedEmployee, sheetValues]);

  // Profile View
  if (selectedEmployee) {
    return (
      <div style={{ padding: "32px 48px", maxWidth: 1400, margin: "0 auto", fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ background: "#fff", borderRadius: 24, padding: 40, boxShadow: "0 10px 40px rgba(0,0,0,0.08)" }}>

          {/* Header & Back Button */}
          <button
            onClick={() => { setSelectedEmployee(null); setEmployeeDocs(null); setError(null); }}
            style={{ border: "none", background: "transparent", cursor: "pointer", color: "#6b7280", fontWeight: 700, display: "flex", alignItems: "center", gap: 8, marginBottom: 32, fontSize: 14, transition: "color 0.2s" }}
            onMouseOver={(e) => e.currentTarget.style.color = "#111827"}
            onMouseOut={(e) => e.currentTarget.style.color = "#6b7280"}
          >
            ← Back to {{ active: "Active Staff", archive: "Archive Staff", trial: "Trial Staff" }[selectedFolder] || "Folders"}
          </button>

          {(() => {
            const isActive = selectedEmployee.active !== false && !selectedEmployee.leftDate;
            const c = HR_LIBRARY_COMPLIANCE[selectedEmployee.permit] || { label: selectedEmployee.permit || "N/A", icon: "❓", color: "#374151", bg: "#f3f4f6", border: "#d1d5db" };
            return (
              <>
                {/* Header Info Panel */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 32, borderBottom: "1px solid #f3f4f6", paddingBottom: 32 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
                    <div style={{ width: 88, height: 88, borderRadius: "50%", background: isActive ? "linear-gradient(135deg, #FBCFE8 0%, #F472B6 100%)" : "linear-gradient(135deg, #E2E8F0 0%, #94A3B8 100%)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, fontWeight: 800, boxShadow: isActive ? "0 8px 16px rgba(244, 114, 182, 0.3)" : "0 8px 16px rgba(148, 163, 184, 0.3)" }}>
                      {selectedEmployee.name ? selectedEmployee.name.charAt(0).toUpperCase() : "?"}
                    </div>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                        <h2 style={{ fontSize: 32, fontWeight: 800, color: "#831843", margin: 0, fontFamily: "'Outfit', sans-serif", letterSpacing: "-0.02em" }}>
                          {selectedEmployee.name || `${selectedEmployee.firstName} ${selectedEmployee.surname}`}
                        </h2>
                        <span style={{ fontSize: 12, fontWeight: 700, color: isActive ? "#15803d" : "#b91c1c", background: isActive ? "#dcfce7" : "#fee2e2", border: `1px solid ${isActive ? "#86efac" : "#fca5a5"}`, padding: "4px 10px", borderRadius: 12 }}>
                          {isActive ? "Active Staff" : "Inactive / Archived"}
                        </span>
                      </div>
                      <p style={{ color: "#6b7280", margin: "8px 0 0 0", fontSize: 15, fontWeight: 500 }}>
                        {selectedEmployee.roleType === "manager" ? "Store Operations Manager" : "Professional Nail Technician"} — {selectedEmployee.branch || "Unassigned Branch"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Detailed Credentials Grid */}
                <div style={{ background: "#fcf8f9", border: "1px solid #fbcfe8", borderRadius: "20px", padding: "32px", marginBottom: "40px" }}>
                  <h3 style={{ fontSize: "18px", fontWeight: "800", color: "#831843", margin: "0 0 24px 0", fontFamily: "'Outfit', sans-serif", letterSpacing: "-0.01em", display: "flex", alignItems: "center", gap: "8px" }}>
                    <span>📋</span> Employee Credentials & Metadata
                  </h3>
                  
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "24px" }}>
                    {/* Employee Code */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <span style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.1em", color: "#9ca3af" }}>Employee Code</span>
                      <span style={{ fontSize: "15px", fontWeight: "600", color: "#111827" }}>{selectedEmployee.ec || "N/A"}</span>
                    </div>

                    {/* First Name */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <span style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.1em", color: "#9ca3af" }}>First Name</span>
                      <span style={{ fontSize: "15px", fontWeight: "600", color: "#111827" }}>{selectedEmployee.firstName || (selectedEmployee.name ? selectedEmployee.name.split(" ")[0] : "N/A")}</span>
                    </div>

                    {/* Surname */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <span style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.1em", color: "#9ca3af" }}>Surname</span>
                      <span style={{ fontSize: "15px", fontWeight: "600", color: "#111827" }}>{selectedEmployee.surname || (selectedEmployee.name ? selectedEmployee.name.split(" ").slice(1).join(" ") : "N/A")}</span>
                    </div>

                    {/* Role Type */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <span style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.1em", color: "#9ca3af" }}>Role Type</span>
                      <span style={{ fontSize: "15px", fontWeight: "600", color: "#111827", textTransform: "capitalize" }}>{selectedEmployee.roleType || "Tech"}</span>
                    </div>

                    {/* Level */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <span style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.1em", color: "#9ca3af" }}>Level</span>
                      <span style={{ fontSize: "15px", fontWeight: "600", color: "#111827" }}>{selectedEmployee.level || "N/A"}</span>
                    </div>

                    {/* Start Date */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <span style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.1em", color: "#9ca3af" }}>Start Date</span>
                      <span style={{ fontSize: "15px", fontWeight: "600", color: "#111827" }}>{selectedEmployee.startDate || "N/A"}</span>
                    </div>

                    {/* End Date (Only show if Inactive) */}
                    {!isActive && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        <span style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.1em", color: "#b91c1c" }}>End Date (Left Date)</span>
                        <span style={{ fontSize: "15px", fontWeight: "600", color: "#b91c1c" }}>{selectedEmployee.leftDate || "N/A"}</span>
                      </div>
                    )}

                    {/* Contract */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <span style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.1em", color: "#9ca3af" }}>Contract</span>
                      <span style={{ fontSize: "15px", fontWeight: "600", color: "#111827" }}>{selectedEmployee.contract || "N/A"}</span>
                    </div>

                    {/* Compliance / Permit */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <span style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.1em", color: "#9ca3af", marginBottom: 2 }}>Compliance Status</span>
                      <div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: c.color, background: c.bg, border: `1px solid ${c.border}`, padding: "4px 10px", borderRadius: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
                          {c.icon} {c.label}
                        </span>
                      </div>
                    </div>

                    {/* Cell Number */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <span style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.1em", color: "#9ca3af" }}>Cell Number</span>
                      <span style={{ fontSize: "15px", fontWeight: "600", color: "#111827" }}>{selectedEmployee.cellNumber || "N/A"}</span>
                    </div>

                    {/* Email */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <span style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.1em", color: "#9ca3af" }}>Email Address</span>
                      <span style={{ fontSize: "15px", fontWeight: "600", color: "#111827" }}>{selectedEmployee.email || "N/A"}</span>
                    </div>

                    {/* Address */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <span style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.1em", color: "#9ca3af" }}>Address</span>
                      <span style={{ fontSize: "15px", fontWeight: "600", color: "#111827" }}>{selectedEmployee.address || "N/A"}</span>
                    </div>

                    {/* ID Number / Passport */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <span style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.1em", color: "#9ca3af" }}>
                        {selectedEmployee.idNumber ? "ID Number" : (selectedEmployee.passport ? "Passport Number" : "ID / Passport Number")}
                      </span>
                      <span style={{ fontSize: "15px", fontWeight: "600", color: "#111827" }}>
                        {selectedEmployee.idNumber || selectedEmployee.passport || "N/A"}
                      </span>
                    </div>

                    {/* Tax Number */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <span style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.1em", color: "#9ca3af" }}>Tax Number</span>
                      <span style={{ fontSize: "15px", fontWeight: "600", color: "#111827" }}>{selectedEmployee.taxNumber || "N/A"}</span>
                    </div>

                    {/* Gender */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <span style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.1em", color: "#9ca3af" }}>Gender</span>
                      <span style={{ fontSize: "15px", fontWeight: "600", color: "#111827" }}>
                        {selectedEmployee.gender === "F" ? "Female 👩" : (selectedEmployee.gender === "M" ? "Male 👨" : selectedEmployee.gender || "N/A")}
                      </span>
                    </div>
                  </div>
                </div>
              </>
            );
          })()}

          {error && (
            <div style={{ background: "#fee2e2", borderLeft: "4px solid #ef4444", padding: 16, marginBottom: 24, borderRadius: 4, color: "#991b1b" }}>
              {error}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40 }}>
            {/* HR Documents Section */}
            <div>
              <h3 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginBottom: 20, fontFamily: "'Outfit', sans-serif" }}>Human Resources Documents</h3>

              {!token ? (
                <div style={{ background: "#f9fafb", border: "1px dashed #d1d5db", borderRadius: 16, padding: 32, textAlign: "center" }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>📁</div>
                  <p style={{ color: "#4b5563", marginBottom: 20, fontSize: 15, fontWeight: 500 }}>Securely connect to Google Workspace to load this employee's documents directly from Drive.</p>
                  <button
                    onClick={handleAuthClick}
                    style={{ background: "#4285F4", color: "#fff", border: "none", borderRadius: 8, padding: "12px 24px", fontWeight: 700, cursor: "pointer", fontSize: 15, boxShadow: "0 4px 12px rgba(66, 133, 244, 0.3)" }}
                  >
                    Sign in with Google
                  </button>
                </div>
              ) : (
                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 16, padding: 24 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <div style={{ fontWeight: 700, color: "#166534", display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", display: "inline-block" }}></span>
                      Drive Connected
                    </div>
                    <button
                      onClick={() => fetchEmployeeDocuments(selectedEmployee)}
                      disabled={loadingDocs}
                      style={{ background: "#15803d", color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", fontWeight: 700, cursor: loadingDocs ? "wait" : "pointer", opacity: loadingDocs ? 0.7 : 1, transition: "background 0.2s" }}
                      onMouseOver={(e) => !loadingDocs && (e.currentTarget.style.background = "#166534")}
                      onMouseOut={(e) => !loadingDocs && (e.currentTarget.style.background = "#15803d")}
                    >
                      {loadingDocs ? "Scanning Drive..." : "Load Documents"}
                    </button>
                  </div>

                  {loadingDocs && <div style={{ color: "#166534", fontStyle: "italic", fontSize: 14 }}>Scanning category folders for "{selectedEmployee.name}"...</div>}

                  {employeeDocs && !loadingDocs && (
                    <div style={{ marginTop: 24 }}>
                      {employeeDocs.foldersFound === 0 ? (
                        <div style={{ color: "#b91c1c", fontSize: 14, background: "#fee2e2", padding: 12, borderRadius: 8, fontWeight: 500 }}>
                          No folders found matching "{selectedEmployee.name}".
                          <div style={{ fontSize: 12, marginTop: 4, color: "#991b1b", fontWeight: 400 }}>Ensure their folder name in Drive closely matches their registered name.</div>
                        </div>
                      ) : (
                        <div>
                          <div style={{ fontSize: 13, color: "#166534", marginBottom: 16, fontWeight: 600 }}>
                            Retrieved {employeeDocs.files.length} file(s) from {employeeDocs.foldersFound} folder(s).
                          </div>
                          {employeeDocs.files.length > 0 ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 400, overflowY: "auto", paddingRight: 8 }}>
                              {employeeDocs.files.map(f => (
                                <a
                                  key={f.id}
                                  href={f.webViewLink}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", background: "#fff", borderRadius: 12, textDecoration: "none", color: "#1f2937", border: "1px solid #e5e7eb", transition: "all 0.2s", boxShadow: "0 2px 4px rgba(0,0,0,0.02)" }}
                                  onMouseOver={e => { e.currentTarget.style.borderColor = "#10b981"; e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(16, 185, 129, 0.1)"; }}
                                  onMouseOut={e => { e.currentTarget.style.borderColor = "#e5e7eb"; e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 2px 4px rgba(0,0,0,0.02)"; }}
                                >
                                  <img src={f.iconLink} alt="" style={{ width: 24, height: 24 }} />
                                  <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
                                    <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.name}</span>
                                    <span style={{ fontSize: 11, color: "#6b7280" }}>Added: {new Date(f.createdTime).toLocaleDateString()}</span>
                                  </div>
                                  <span style={{ marginLeft: "auto", color: "#10b981", fontSize: 18 }}>↗</span>
                                </a>
                              ))}
                            </div>
                          ) : (
                            <div style={{ color: "#4b5563", fontSize: 14, fontStyle: "italic" }}>The folder was found, but it is currently empty.</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Historical Record Section */}
            <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
              <h3 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginBottom: 20, fontFamily: "'Outfit', sans-serif" }}>Historical Ledger</h3>

              {!token ? (
                <div style={{ background: "#f9fafb", border: "1px dashed #d1d5db", borderRadius: 16, padding: 32, textAlign: "center", flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>📈</div>
                  <p style={{ color: "#4b5563", marginBottom: 16, fontSize: 15, fontWeight: 500 }}>Sign in with Google to load the Master Attendance Sheet and view historical incidents.</p>
                </div>
              ) : !sheetValues ? (
                <div style={{ background: "#f9fafb", border: "1px dashed #d1d5db", borderRadius: 16, padding: 32, textAlign: "center", flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                  <p style={{ color: "#4b5563", marginBottom: 16, fontSize: 15, fontWeight: 500 }}>Load the Master Attendance Sheet to view historical incidents and records for this employee.</p>
                  <button
                    onClick={fetchSheetData}
                    disabled={loading}
                    style={{ background: "#10b981", color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", fontWeight: 700, cursor: loading ? "wait" : "pointer" }}
                  >
                    {loading ? "Fetching Sheet..." : "Load Attendance Sheet"}
                  </button>
                </div>
              ) : (
                <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, padding: 24, flex: 1, maxHeight: 500, overflowY: "auto", boxShadow: "0 2px 8px rgba(0,0,0,0.02)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, borderBottom: "1px solid #f3f4f6", paddingBottom: 12 }}>
                    <div style={{ fontWeight: 700, color: "#111827" }}>Attendance & Incidents</div>
                    <div style={{ fontSize: 13, color: "#6b7280" }}>{employeeLedger?.length || 0} records found</div>
                  </div>

                  {employeeLedger && employeeLedger.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                      {employeeLedger.map((rec, i) => (
                        <div key={i} style={{ display: "flex", gap: 16, paddingBottom: 16, borderBottom: i === employeeLedger.length - 1 ? "none" : "1px solid #f3f4f6" }}>
                          <div style={{ width: 32, height: 32, borderRadius: "50%", background: rec.isIncident ? "#fee2e2" : "#dcfce7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{rec.icon}</div>
                          <div style={{ paddingTop: 4 }}>
                            <div style={{ fontSize: 15, color: rec.isIncident ? "#b91c1c" : "#166534", fontWeight: 700 }}>{rec.title}</div>
                            <div style={{ fontSize: 14, color: "#4b5563", marginTop: 4 }}>{rec.subtitle}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ textAlign: "center", padding: "40px 0", color: "#6b7280" }}>
                      <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
                      <div style={{ fontWeight: 600, color: "#374151" }}>Clean Record</div>
                      <div style={{ fontSize: 14 }}>No attendance records or incidents found for this employee.</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Folder Selection Dashboard
  if (!selectedFolder) {
    return (
      <div style={{ padding: "32px 48px", maxWidth: 1400, margin: "0 auto", fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 36, fontWeight: 800, color: "#831843", marginBottom: 8, fontFamily: "'Outfit', sans-serif", letterSpacing: "-0.02em" }}>Employee Files</h2>
          <p style={{ color: "#6b7280", fontSize: 16, margin: 0 }}>Consolidated directory of staff files, documents, and compliance records.</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 24 }}>
          {/* Active Staff Folder */}
          <div
            onClick={() => { setSelectedFolder("active"); setSearchQuery(""); }}
            style={{ background: "#fff", borderRadius: 20, padding: "32px 28px", boxShadow: "0 4px 20px rgba(0,0,0,0.03)", border: "1px solid #f3f4f6", cursor: "pointer", transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)", display: "flex", flexDirection: "column", gap: 20 }}
            onMouseOver={(e) => { e.currentTarget.style.transform = "translateY(-6px)"; e.currentTarget.style.boxShadow = "0 15px 30px rgba(131, 24, 67, 0.05)"; e.currentTarget.style.borderColor = "#FBCFE8"; }}
            onMouseOut={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,0.03)"; e.currentTarget.style.borderColor = "#f3f4f6"; }}
          >
            <div style={{ width: 64, height: 64, borderRadius: 16, background: "#eff6ff", color: "#2563eb", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32 }}>📁</div>
            <div>
              <h3 style={{ fontSize: 22, fontWeight: 800, color: "#111827", margin: "0 0 6px 0", fontFamily: "'Outfit', sans-serif" }}>Active Staff</h3>
              <p style={{ color: "#6b7280", fontSize: 14, margin: "0 0 16px 0", lineHeight: 1.5 }}>Files, attendance sheets, and compliance documents for currently working nail techs and managers.</p>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#dbeafe", color: "#1e40af", padding: "4px 10px", borderRadius: 12, fontSize: 12, fontWeight: 700 }}>
                👥 {activeEmployees.length} File(s)
              </div>
            </div>
          </div>

          {/* Archive Staff Folder */}
          <div
            onClick={() => { setSelectedFolder("archive"); setSearchQuery(""); }}
            style={{ background: "#fff", borderRadius: 20, padding: "32px 28px", boxShadow: "0 4px 20px rgba(0,0,0,0.03)", border: "1px solid #f3f4f6", cursor: "pointer", transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)", display: "flex", flexDirection: "column", gap: 20 }}
            onMouseOver={(e) => { e.currentTarget.style.transform = "translateY(-6px)"; e.currentTarget.style.boxShadow = "0 15px 30px rgba(131, 24, 67, 0.05)"; e.currentTarget.style.borderColor = "#FBCFE8"; }}
            onMouseOut={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,0.03)"; e.currentTarget.style.borderColor = "#f3f4f6"; }}
          >
            <div style={{ width: 64, height: 64, borderRadius: 16, background: "#f1f5f9", color: "#475569", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32 }}>📁</div>
            <div>
              <h3 style={{ fontSize: 22, fontWeight: 800, color: "#111827", margin: "0 0 6px 0", fontFamily: "'Outfit', sans-serif" }}>Archive Staff</h3>
              <p style={{ color: "#6b7280", fontSize: 14, margin: "0 0 16px 0", lineHeight: 1.5 }}>Historical files, termination letters, and final records of past employees and off-boarded staff.</p>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#e2e8f0", color: "#334155", padding: "4px 10px", borderRadius: 12, fontSize: 12, fontWeight: 700 }}>
                👋 {archiveEmployees.length} File(s)
              </div>
            </div>
          </div>

          {/* Trial Staff Folder */}
          <div
            onClick={() => { setSelectedFolder("trial"); setSearchQuery(""); }}
            style={{ background: "#fff", borderRadius: 20, padding: "32px 28px", boxShadow: "0 4px 20px rgba(0,0,0,0.03)", border: "1px solid #f3f4f6", cursor: "pointer", transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)", display: "flex", flexDirection: "column", gap: 20 }}
            onMouseOver={(e) => { e.currentTarget.style.transform = "translateY(-6px)"; e.currentTarget.style.boxShadow = "0 15px 30px rgba(131, 24, 67, 0.05)"; e.currentTarget.style.borderColor = "#FBCFE8"; }}
            onMouseOut={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,0.03)"; e.currentTarget.style.borderColor = "#f3f4f6"; }}
          >
            <div style={{ width: 64, height: 64, borderRadius: 16, background: "#f0fdf4", color: "#16a34a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32 }}>📁</div>
            <div>
              <h3 style={{ fontSize: 22, fontWeight: 800, color: "#111827", margin: "0 0 6px 0", fontFamily: "'Outfit', sans-serif" }}>Trial Staff</h3>
              <p style={{ color: "#6b7280", fontSize: 14, margin: "0 0 16px 0", lineHeight: 1.5 }}>Files, review results, and contracts for trainees in onboarding stages or provisional trial weeks.</p>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#dcfce7", color: "#15803d", padding: "4px 10px", borderRadius: 12, fontSize: 12, fontWeight: 700 }}>
                🌱 {trialEmployees.length} File(s)
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const folderTitle = {
    active: "Active Staff",
    archive: "Archive Staff",
    trial: "Trial Staff"
  }[selectedFolder];

  const folderColor = {
    active: "#2563eb",
    archive: "#475569",
    trial: "#16a34a"
  }[selectedFolder];

  return (
    <div style={{ padding: "32px 48px", maxWidth: 1400, margin: "0 auto", fontFamily: "'DM Sans', sans-serif" }}>
      
      {/* Back to folders navigation / Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24 }}>
        <button
          onClick={() => setSelectedFolder(null)}
          style={{ border: "none", background: "transparent", cursor: "pointer", color: "#6b7280", fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 4, transition: "color 0.2s" }}
          onMouseOver={(e) => e.currentTarget.style.color = "#111827"}
          onMouseOut={(e) => e.currentTarget.style.color = "#6b7280"}
        >
          📁 Employee Files
        </button>
        <span style={{ color: "#9ca3af", fontWeight: 600 }}>&gt;</span>
        <span style={{ color: folderColor, fontWeight: 800, fontSize: 14 }}>{folderTitle}</span>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 32 }}>
        <div>
          <h2 style={{ fontSize: 36, fontWeight: 800, color: "#831843", marginBottom: 8, fontFamily: "'Outfit', sans-serif", letterSpacing: "-0.02em" }}>{folderTitle}</h2>
          <p style={{ color: "#6b7280", fontSize: 16, margin: 0 }}>Files and documents inside your {folderTitle} database.</p>
        </div>
        <div>
          <div style={{ position: "relative", width: 320 }}>
            <span style={{ position: "absolute", left: 14, top: 12, color: "#9ca3af" }}>🔍</span>
            <input
              type="text"
              placeholder={`Search ${folderTitle.toLowerCase()}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box", padding: "12px 16px 12px 40px", borderRadius: 12, border: "1px solid #d1d5db", fontSize: 15, fontFamily: "inherit", outline: "none", boxShadow: "0 2px 4px rgba(0,0,0,0.02)" }}
            />
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 20 }}>
        {filteredEmployees.map(emp => (
          <div
            key={emp._id || emp.ec || emp.name}
            onClick={() => setSelectedEmployee(emp)}
            style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 4px 12px rgba(0,0,0,0.04)", cursor: "pointer", transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)", border: "1px solid #f3f4f6" }}
            onMouseOver={(e) => { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = `0 12px 24px rgba(190, 24, 93, 0.08)`; e.currentTarget.style.borderColor = "#FBCFE8"; }}
            onMouseOut={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.04)"; e.currentTarget.style.borderColor = "#f3f4f6"; }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
              <div style={{ width: 56, height: 56, borderRadius: "50%", background: "linear-gradient(135deg, #FDEEF5 0%, #FBCFE8 100%)", color: "#BE185D", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 800 }}>
                {(() => {
                   const dName = emp.name || `${emp.firstName || ""} ${emp.surname || ""}`.trim();
                   return dName ? dName.charAt(0).toUpperCase() : "?";
                })()}
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#111827", marginBottom: 4, fontFamily: "'Outfit', sans-serif" }}>
                  {emp.name || `${emp.firstName || ""} ${emp.surname || ""}`.trim() || "Unknown Staff"}
                </div>
                <div style={{ fontSize: 13, color: "#6b7280", fontWeight: 600 }}>{emp.position || emp.role || "Nail Tech"}</div>
              </div>
            </div>

            <div style={{ background: "#f9fafb", borderRadius: 8, padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>ID</span>
                <span style={{ fontSize: 13, color: "#374151", fontWeight: 600 }}>{emp.ec || "N/A"}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", textAlign: "right" }}>
                <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>Branch</span>
                <span style={{ fontSize: 13, color: "#374151", fontWeight: 600 }}>{emp.branch || "N/A"}</span>
              </div>
            </div>
          </div>
        ))}

        {filteredEmployees.length === 0 && (
          <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "64px 0", color: "#6b7280" }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>🔍</div>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: "#374151", marginBottom: 8 }}>No files found</h3>
            <p>We couldn't find anyone matching "{searchQuery}" inside this folder.</p>
          </div>
        )}
      </div>
    </div>
  );
};

window.EmployeeDataLibrary = EmployeeDataLibrary;
