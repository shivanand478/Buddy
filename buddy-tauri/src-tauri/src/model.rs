use chrono::{DateTime, Datelike, Local, NaiveDate, NaiveTime, TimeZone};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ---------------------------------------------------------------- characters

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CharacterId {
    Nub,
    Miso,
    Bolt,
    Zib,
    Pip,
}

impl Default for CharacterId {
    fn default() -> Self {
        CharacterId::Nub
    }
}

// ---------------------------------------------------------------- scheduling

/// How a task comes back. Kept deliberately small — the spec rules out
/// anything more elaborate for V1.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Repeat {
    #[default]
    None,
    Daily,
    Weekdays,
    Weekly,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ItemKind {
    Task,
    Routine,
    Water,
    Goal,
    Team,
    Review,
}

/// Everything that can produce a reminder collapses into one of these before
/// it reaches the front end, so the popup only ever renders one shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DueItem {
    pub id: String,
    pub kind: ItemKind,
    pub title: String,
    /// "4:30 PM", or "Hourly" for water.
    pub time_label: String,
    pub subtitle: Option<String>,
    /// Sort key so the grouped popup lists things in the order they happen.
    pub sort_minutes: i64,
}

// ---------------------------------------------------------------- stored items

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    #[serde(default = "new_id")]
    pub id: String,
    pub title: String,
    /// Local date, `YYYY-MM-DD`.
    pub date: String,
    /// Local time of day, `HH:MM` on a 24-hour clock.
    pub time: String,
    #[serde(default)]
    pub duration_min: Option<u32>,
    /// Minutes *before* `time` that Buddy should appear. 0 means "at the time".
    #[serde(default)]
    pub remind_offset_min: u32,
    #[serde(default)]
    pub repeat: Repeat,
    #[serde(default)]
    pub done: bool,
    #[serde(default)]
    pub skipped: bool,
    #[serde(default)]
    pub notes: Option<String>,
    /// Present when the task arrived from a team member.
    #[serde(default)]
    pub assigned_by: Option<String>,
    #[serde(default)]
    pub snoozed_until: Option<i64>,
    #[serde(default)]
    pub fired_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutineItem {
    #[serde(default = "new_id")]
    pub id: String,
    pub title: String,
    #[serde(default = "default_emoji")]
    pub emoji: String,
    /// `HH:MM`.
    pub time: String,
    /// Weekday numbers, Monday = 1 … Sunday = 7. Empty means every day.
    #[serde(default)]
    pub days: Vec<u32>,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub completed_on: Option<String>,
    #[serde(default)]
    pub skipped_on: Option<String>,
    #[serde(default)]
    pub snoozed_until: Option<i64>,
    #[serde(default)]
    pub fired_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Water {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_water_minutes")]
    pub every_minutes: u32,
    #[serde(default)]
    pub count_today: u32,
    #[serde(default)]
    pub count_date: Option<String>,
    #[serde(default)]
    pub last_fired: Option<i64>,
    #[serde(default)]
    pub snoozed_until: Option<i64>,
}

impl Default for Water {
    fn default() -> Self {
        Water {
            enabled: false,
            every_minutes: 60,
            count_today: 0,
            count_date: None,
            last_fired: None,
            snoozed_until: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Goal {
    #[serde(default = "new_id")]
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub emoji: String,
    /// Free text — "Work on it 5 hours".
    #[serde(default)]
    pub weekly_target: String,
    /// The one concrete thing to do today, and when.
    #[serde(default)]
    pub today_action: String,
    #[serde(default)]
    pub today_time: Option<String>,
    #[serde(default)]
    pub fired_at: Option<i64>,
    #[serde(default = "yes")]
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Prefs {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub character: CharacterId,
    /// Minutes from midnight. Quiet hours wrap past midnight.
    #[serde(default = "default_quiet_start")]
    pub quiet_start: u32,
    #[serde(default = "default_quiet_end")]
    pub quiet_end: u32,
    #[serde(default = "default_dismiss")]
    pub dismiss_seconds: u32,
    #[serde(default)]
    pub autostart: bool,
    #[serde(default)]
    pub onboarded: bool,
    #[serde(default)]
    pub focus_areas: Vec<String>,
    #[serde(default = "yes")]
    pub native_notifications: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs {
            name: String::new(),
            character: CharacterId::default(),
            quiet_start: default_quiet_start(),
            quiet_end: default_quiet_end(),
            dismiss_seconds: default_dismiss(),
            autostart: false,
            onboarded: false,
            focus_areas: Vec::new(),
            native_notifications: true,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AppData {
    #[serde(default)]
    pub prefs: Prefs,
    #[serde(default)]
    pub tasks: Vec<Task>,
    #[serde(default)]
    pub routine: Vec<RoutineItem>,
    #[serde(default)]
    pub water: Water,
    #[serde(default)]
    pub goals: Vec<Goal>,
    /// Rolling record of completed/total per day, for the weekly check-in.
    #[serde(default)]
    pub history: Vec<DayLog>,
    #[serde(default)]
    pub last_rollover: Option<String>,
    #[serde(default)]
    pub last_weekly_review: Option<String>,
    /// Date of the last morning check-in, so it runs once a day.
    #[serde(default)]
    pub last_briefing: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DayLog {
    pub date: String,
    pub tasks_done: u32,
    pub tasks_total: u32,
    pub routine_done: u32,
    pub routine_total: u32,
}

// ---------------------------------------------------------------- helpers

fn new_id() -> String {
    Uuid::new_v4().to_string()
}
fn yes() -> bool {
    true
}
fn default_emoji() -> String {
    "•".to_string()
}
fn default_water_minutes() -> u32 {
    60
}
fn default_quiet_start() -> u32 {
    23 * 60
}
fn default_quiet_end() -> u32 {
    8 * 60
}
fn default_dismiss() -> u32 {
    12
}

pub fn today_string() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

pub fn minutes_now() -> u32 {
    let now = Local::now();
    now.hour_min()
}

trait HourMin {
    fn hour_min(&self) -> u32;
}

impl HourMin for DateTime<Local> {
    fn hour_min(&self) -> u32 {
        use chrono::Timelike;
        self.hour() * 60 + self.minute()
    }
}

/// Parses `HH:MM` into minutes from midnight.
pub fn parse_hhmm(s: &str) -> Option<u32> {
    let mut parts = s.split(':');
    let h: u32 = parts.next()?.trim().parse().ok()?;
    let m: u32 = parts.next()?.trim().parse().ok()?;
    if h > 23 || m > 59 {
        return None;
    }
    Some(h * 60 + m)
}

/// Renders minutes from midnight as `4:30 PM`.
pub fn label_minutes(m: u32) -> String {
    let h24 = (m / 60) % 24;
    let min = m % 60;
    let suffix = if h24 < 12 { "AM" } else { "PM" };
    let mut h = h24 % 12;
    if h == 0 {
        h = 12;
    }
    format!("{}:{:02} {}", h, min, suffix)
}

/// Local wall-clock time of `date` + `HH:MM` as a unix timestamp.
pub fn timestamp_for(date: &str, time: &str) -> Option<i64> {
    let d = NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()?;
    let mins = parse_hhmm(time)?;
    let t = NaiveTime::from_hms_opt(mins / 60, mins % 60, 0)?;
    Local
        .from_local_datetime(&d.and_time(t))
        .single()
        .map(|dt| dt.timestamp())
}

pub fn now_ts() -> i64 {
    Local::now().timestamp()
}

/// Monday = 1 … Sunday = 7, matching `RoutineItem::days`.
pub fn weekday_now() -> u32 {
    Local::now().weekday().number_from_monday()
}

impl Prefs {
    /// Quiet hours wrap around midnight, so the test flips when start > end.
    pub fn is_quiet(&self) -> bool {
        let m = minutes_now();
        if self.quiet_start == self.quiet_end {
            return false;
        }
        if self.quiet_start < self.quiet_end {
            m >= self.quiet_start && m < self.quiet_end
        } else {
            m >= self.quiet_start || m < self.quiet_end
        }
    }
}

impl Task {
    pub fn is_today(&self) -> bool {
        self.date == today_string()
    }

    /// The moment Buddy should appear: the task's time, pulled earlier by the offset.
    pub fn remind_at(&self) -> Option<i64> {
        timestamp_for(&self.date, &self.time).map(|ts| ts - (self.remind_offset_min as i64) * 60)
    }

    pub fn open(&self) -> bool {
        !self.done && !self.skipped
    }
}

impl RoutineItem {
    pub fn runs_today(&self) -> bool {
        self.enabled && (self.days.is_empty() || self.days.contains(&weekday_now()))
    }

    pub fn done_today(&self) -> bool {
        self.completed_on.as_deref() == Some(&today_string())
    }

    pub fn skipped_today(&self) -> bool {
        self.skipped_on.as_deref() == Some(&today_string())
    }
}

impl Water {
    pub fn roll_day(&mut self) {
        let today = today_string();
        if self.count_date.as_deref() != Some(&today) {
            self.count_today = 0;
            self.count_date = Some(today);
        }
    }
}
