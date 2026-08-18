mod model;
mod scheduler;
mod store;

use model::*;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};

const REMINDER_W: f64 = 372.0;
const REMINDER_H: f64 = 250.0;

pub struct Buddy {
    pub data: Mutex<AppData>,
    pub path: PathBuf,
    /// What the reminder window should render next.
    pub pending: Mutex<Vec<DueItem>>,
}

impl Buddy {
    fn persist(&self) {
        if let Ok(data) = self.data.lock() {
            store::save(&self.path, &data);
        }
    }
}

// ------------------------------------------------------------------ commands

#[tauri::command]
fn get_data(state: tauri::State<'_, Buddy>) -> AppData {
    state.data.lock().map(|d| d.clone()).unwrap_or_default()
}

#[tauri::command]
fn save_data(state: tauri::State<'_, Buddy>, data: AppData) {
    if let Ok(mut slot) = state.data.lock() {
        *slot = data;
    }
    state.persist();
}

#[tauri::command]
fn get_pending(state: tauri::State<'_, Buddy>) -> Vec<DueItem> {
    state.pending.lock().map(|p| p.clone()).unwrap_or_default()
}

/// Marks a due item complete. `id` is the item's own id — "water" and "review"
/// are the two synthetic ones.
#[tauri::command]
fn complete_item(state: tauri::State<'_, Buddy>, id: String, kind: String) {
    if let Ok(mut d) = state.data.lock() {
        let today = today_string();
        match kind.as_str() {
            "water" => {
                d.water.roll_day();
                d.water.count_today += 1;
                d.water.last_fired = Some(now_ts());
            }
            "checkin" => d.check_in.last_fired = Some(now_ts()),
            "routine" => {
                if let Some(r) = d.routine.iter_mut().find(|r| r.id == id) {
                    r.completed_on = Some(today);
                }
            }
            "task" | "team" => {
                if let Some(t) = d.tasks.iter_mut().find(|t| t.id == id) {
                    t.done = true;
                }
            }
            _ => {}
        }
    }
    state.persist();
}

#[tauri::command]
fn skip_item(state: tauri::State<'_, Buddy>, id: String, kind: String) {
    if let Ok(mut d) = state.data.lock() {
        let today = today_string();
        match kind.as_str() {
            "routine" => {
                if let Some(r) = d.routine.iter_mut().find(|r| r.id == id) {
                    r.skipped_on = Some(today);
                }
            }
            "task" | "team" => {
                if let Some(t) = d.tasks.iter_mut().find(|t| t.id == id) {
                    t.skipped = true;
                }
            }
            _ => {}
        }
    }
    state.persist();
}

#[tauri::command]
fn snooze_item(state: tauri::State<'_, Buddy>, id: String, kind: String, minutes: i64) {
    let until = now_ts() + minutes * 60;
    if let Ok(mut d) = state.data.lock() {
        match kind.as_str() {
            "water" => d.water.snoozed_until = Some(until),
            "checkin" => d.check_in.snoozed_until = Some(until),
            "routine" => {
                if let Some(r) = d.routine.iter_mut().find(|r| r.id == id) {
                    r.snoozed_until = Some(until);
                }
            }
            "task" | "team" => {
                if let Some(t) = d.tasks.iter_mut().find(|t| t.id == id) {
                    t.snoozed_until = Some(until);
                }
            }
            _ => {}
        }
    }
    state.persist();
}

#[tauri::command]
fn close_reminder(app: AppHandle) {
    if let Some(win) = app.get_webview_window("reminder") {
        let _ = win.hide();
    }
}

#[tauri::command]
fn open_main(app: AppHandle) {
    show_main(&app);
}

#[tauri::command]
fn finish_onboarding(app: AppHandle, state: tauri::State<'_, Buddy>) {
    if let Ok(mut d) = state.data.lock() {
        d.prefs.onboarded = true;
    }
    state.persist();
    if let Some(win) = app.get_webview_window("onboarding") {
        let _ = win.close();
    }
    show_main(&app);
}

/// Closes the sign-in window and hands off to whatever comes next.
#[tauri::command]
fn finish_auth(app: AppHandle, state: tauri::State<'_, Buddy>) {
    let onboarded = state
        .data
        .lock()
        .map(|d| d.prefs.onboarded)
        .unwrap_or(false);
    if let Some(win) = app.get_webview_window("auth") {
        let _ = win.close();
    }
    if onboarded {
        show_main(&app);
    } else {
        show_onboarding(&app);
    }
}

#[tauri::command]
fn sign_out(app: AppHandle, state: tauri::State<'_, Buddy>) {
    if let Ok(mut d) = state.data.lock() {
        d.account = Account::default();
    }
    state.persist();
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.close();
    }
    show_auth(&app);
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let mgr = app.autolaunch();
    let res = if enabled { mgr.enable() } else { mgr.disable() };
    res.map_err(|e| e.to_string())
}

/// Shows whatever is due right now, ignoring the clock. Used by "Test reminder".
#[tauri::command]
fn test_reminder(app: AppHandle, state: tauri::State<'_, Buddy>) {
    let sample = vec![DueItem {
        id: "test".into(),
        kind: ItemKind::Task,
        title: "This is what a reminder looks like.".into(),
        time_label: label_minutes(minutes_now()),
        subtitle: Some("Done, Snooze or Skip — then I'm gone.".into()),
        sort_minutes: 0,
    }];
    if let Ok(mut p) = state.pending.lock() {
        *p = sample.clone();
    }
    present(&app, sample);
}


/// True when today's check-in hasn't happened yet. Drives the morning window.
#[tauri::command]
fn needs_briefing(state: tauri::State<'_, Buddy>) -> bool {
    state
        .data
        .lock()
        .map(|d| d.prefs.onboarded && d.last_briefing.as_deref() != Some(&today_string()))
        .unwrap_or(false)
}

#[tauri::command]
fn finish_briefing(state: tauri::State<'_, Buddy>) {
    if let Ok(mut d) = state.data.lock() {
        d.last_briefing = Some(today_string());
    }
    state.persist();
}

/// Everything still open from before today — what the morning check-in offers
/// to carry forward.
#[tauri::command]
fn unfinished_before_today(state: tauri::State<'_, Buddy>) -> Vec<Task> {
    let today = today_string();
    state
        .data
        .lock()
        .map(|d| {
            d.tasks
                .iter()
                .filter(|t| t.open() && t.date < today)
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

/// Moves a stale task on to today at a new time, clearing its fired state so
/// it can remind again.
#[tauri::command]
fn carry_over(state: tauri::State<'_, Buddy>, id: String, time: String) {
    if let Ok(mut d) = state.data.lock() {
        if let Some(t) = d.tasks.iter_mut().find(|t| t.id == id) {
            t.date = today_string();
            t.time = time;
            t.fired_at = None;
            t.snoozed_until = None;
            t.skipped = false;
        }
    }
    state.persist();
}

#[tauri::command]
fn drop_task(state: tauri::State<'_, Buddy>, id: String) {
    if let Ok(mut d) = state.data.lock() {
        d.tasks.retain(|t| t.id != id);
    }
    state.persist();
}

// ------------------------------------------------------------------ windows

fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Buddy")
        .inner_size(880.0, 640.0)
        .min_inner_size(720.0, 520.0)
        .resizable(true)
        .build();
}

fn show_auth(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("auth") {
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(app, "auth", WebviewUrl::App("auth.html".into()))
        .title("Buddy")
        .inner_size(460.0, 600.0)
        .resizable(false)
        .center()
        .build();
}

fn show_onboarding(app: &AppHandle) {
    let _ = WebviewWindowBuilder::new(app, "onboarding", WebviewUrl::App("onboarding.html".into()))
        .title("Welcome to Buddy")
        .inner_size(560.0, 600.0)
        .resizable(false)
        .center()
        .build();
}

/// Puts the reminder in the bottom-right corner without taking focus.
fn present(app: &AppHandle, items: Vec<DueItem>) {
    if let Ok(mut p) = app.state::<Buddy>().pending.lock() {
        *p = items.clone();
    }

    let win = match app.get_webview_window("reminder") {
        Some(w) => w,
        None => {
            match WebviewWindowBuilder::new(app, "reminder", WebviewUrl::App("reminder.html".into()))
                .title("Buddy")
                .inner_size(REMINDER_W, REMINDER_H)
                .decorations(false)
                .transparent(true)
                .always_on_top(true)
                .skip_taskbar(true)
                .resizable(false)
                .shadow(false)
                .focused(false)
                .visible(false)
                .build()
            {
                Ok(w) => w,
                Err(e) => {
                    eprintln!("buddy: could not create reminder window: {e}");
                    return;
                }
            }
        }
    };

    place_bottom_right(&win);
    let _ = win.emit("buddy://show", items.clone());
    let _ = win.show();

    // A native notification too, so it still lands if the user is full-screen.
    if let Ok(d) = app.state::<Buddy>().data.lock() {
        if d.prefs.native_notifications {
            if let Some(first) = items.first() {
                use tauri_plugin_notification::NotificationExt;
                let _ = app
                    .notification()
                    .builder()
                    .title("Buddy")
                    .body(&first.title)
                    .show();
            }
        }
    }
}

fn place_bottom_right(win: &tauri::WebviewWindow) {
    let Ok(Some(monitor)) = win.current_monitor() else {
        return;
    };
    let scale = monitor.scale_factor();
    let size = monitor.size().to_logical::<f64>(scale);
    let pos = monitor.position().to_logical::<f64>(scale);
    let margin = 18.0;
    // Leave room for the Dock / taskbar at the bottom.
    let reserved = 80.0;
    let x = pos.x + size.width - REMINDER_W - margin;
    let y = pos.y + size.height - REMINDER_H - reserved;
    let _ = win.set_position(tauri::LogicalPosition::new(x, y));
}

// ------------------------------------------------------------------ run

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            get_data,
            save_data,
            get_pending,
            complete_item,
            skip_item,
            snooze_item,
            close_reminder,
            open_main,
            finish_onboarding,
            finish_auth,
            sign_out,
            set_autostart,
            test_reminder,
            needs_briefing,
            finish_briefing,
            unfinished_before_today,
            carry_over,
            drop_task,
        ])
        .setup(|app| {
            // Menu-bar / tray only: no Dock icon, no app-switcher entry.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let handle = app.handle().clone();
            let path = store::data_file(&handle);
            let mut data = store::load(&path);
            scheduler::rollover(&mut data);
            let onboarded = data.prefs.onboarded;
            let signed_in = data.account.signed_in();
            let data_last_briefing = data.last_briefing.clone();
            store::save(&path, &data);

            app.manage(Buddy {
                data: Mutex::new(data),
                path,
                pending: Mutex::new(Vec::new()),
            });

            build_tray(&handle)?;

            if !signed_in {
                show_auth(&handle);
            } else if !onboarded {
                show_onboarding(&handle);
            } else if data_last_briefing.as_deref() != Some(today_string().as_str()) {
                // First launch of the day (login, or a manual open): greet the
                // user and settle what today looks like before going quiet.
                show_main(&handle);
            }

            // The clock. Every 15 seconds, ask what's due.
            let tick_handle = handle.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(15));

                let state = tick_handle.state::<Buddy>();
                let due = {
                    let Ok(mut data) = state.data.lock() else {
                        continue;
                    };
                    scheduler::rollover(&mut data);
                    scheduler::collect_due(&mut data)
                };
                state.persist();

                if !due.is_empty() {
                    let h = tick_handle.clone();
                    let inner = h.clone();
                    let _ = h.run_on_main_thread(move || {
                        present(&inner, due);
                    });
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Buddy");
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Buddy", true, None::<&str>)?;
    let test = MenuItem::with_id(app, "test", "Test reminder", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Buddy", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &test, &quit])?;

    TrayIconBuilder::with_id("buddy")
        .icon(app.default_window_icon().unwrap().clone())
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "test" => {
                let state = app.state::<Buddy>();
                test_reminder(app.clone(), state);
            }
            "quit" => {
                app.state::<Buddy>().persist();
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}
