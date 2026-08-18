// Stands in for the Tauri bridge so the UI can be inspected in a plain browser.
const DATA = {
  prefs: { name: "Shiv", character: "nub", quiet_start: 1380, quiet_end: 480,
           dismiss_seconds: 12, autostart: false, onboarded: true,
           focus_areas: ["Work","Fitness"], native_notifications: true },
  tasks: [
    { id:"1", title:"Finish the homepage", date:new Date().toLocaleDateString('en-CA'),
      time:"09:30", duration_min:30, remind_offset_min:0, repeat:"none",
      done:true, skipped:false, assigned_by:null },
    { id:"2", title:"Create content", date:new Date().toLocaleDateString('en-CA'),
      time:"19:00", duration_min:60, remind_offset_min:15, repeat:"daily",
      done:false, skipped:false, assigned_by:null },
    { id:"3", title:"Finish the mobile homepage", date:new Date().toLocaleDateString('en-CA'),
      time:"16:30", duration_min:null, remind_offset_min:0, repeat:"none",
      done:false, skipped:false, assigned_by:"Shiv" }
  ],
  routine: [
    { id:"r1", title:"Gym", emoji:"🏋️", time:"17:30", days:[1,3,5], enabled:true, completed_on:null },
    { id:"r2", title:"Lunch", emoji:"🍱", time:"13:30", days:[], enabled:true, completed_on:null }
  ],
  water: { enabled:true, every_minutes:60, count_today:3 },
  check_in: { enabled:false, every_minutes:120, last_fired:null, snoozed_until:null },
  goals: [ { id:"g1", title:"Build a SaaS", emoji:"🚀", weekly_target:"Work on it 5 hours",
             today_action:"30 minutes on the landing page", today_time:"20:00", active:true } ],
  history: []
};
window.__CALLS__ = [];
window.__TAURI__ = {
  core: { invoke: async (cmd, args) => {
    window.__CALLS__.push({ cmd, args: args ? JSON.parse(JSON.stringify(args)) : null });
    if (cmd === 'get_data') return JSON.parse(JSON.stringify(DATA));
    if (cmd === 'get_pending') return [
      { id:"2", kind:"task", title:"Time to create content.", time_label:"7:00 PM",
        subtitle:"60 minutes planned.", sort_minutes:1140 }
    ];
    console.log('invoke', cmd, args); return null;
  }},
  event: { listen: async () => () => {} }
};
