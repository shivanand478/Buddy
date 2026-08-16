use crate::model::*;

/// How long after its moment a reminder is still worth showing. Past this the
/// moment has gone and nagging about it is just noise.
const GRACE_SECONDS: i64 = 15 * 60;

/// Gathers everything that has come due *right now*.
///
/// The important behaviour is in the caller: whatever this returns is delivered
/// as **one** popup. Three things due at 5:30 produce one grouped reminder, not
/// three windows fighting for the corner of the screen.
pub fn collect_due(data: &mut AppData) -> Vec<DueItem> {
    if data.prefs.is_quiet() {
        return Vec::new();
    }

    let now = now_ts();
    let today = today_string();
    let mut out: Vec<DueItem> = Vec::new();

    // ---- tasks -----------------------------------------------------------
    for task in data.tasks.iter_mut() {
        if !task.open() {
            continue;
        }
        let Some(base) = task.remind_at() else { continue };
        let target = task.snoozed_until.unwrap_or(base);

        if let Some(fired) = task.fired_at {
            // Already shown for this target; a snooze moves the target forward.
            if fired >= target {
                continue;
            }
        }
        if now < target || now - target > GRACE_SECONDS {
            continue;
        }

        task.fired_at = Some(now);
        task.snoozed_until = None;

        let kind = if task.assigned_by.is_some() {
            ItemKind::Team
        } else {
            ItemKind::Task
        };
        let subtitle = match (&task.assigned_by, task.duration_min) {
            (Some(by), _) => Some(format!("Assigned by {by}.")),
            (None, Some(d)) => Some(format!("{d} minutes planned.")),
            _ => None,
        };

        out.push(DueItem {
            id: task.id.clone(),
            kind,
            title: task.title.clone(),
            time_label: parse_hhmm(&task.time).map(label_minutes).unwrap_or_default(),
            subtitle,
            sort_minutes: parse_hhmm(&task.time).unwrap_or(0) as i64,
        });
    }

    // ---- routine ---------------------------------------------------------
    for item in data.routine.iter_mut() {
        if !item.runs_today() || item.done_today() || item.skipped_today() {
            continue;
        }
        let Some(base) = timestamp_for(&today, &item.time) else { continue };
        let target = item.snoozed_until.unwrap_or(base);

        if let Some(fired) = item.fired_at {
            if fired >= target {
                continue;
            }
        }
        if now < target || now - target > GRACE_SECONDS {
            continue;
        }

        item.fired_at = Some(now);
        item.snoozed_until = None;

        out.push(DueItem {
            id: item.id.clone(),
            kind: ItemKind::Routine,
            title: format!("{} {}", item.emoji, item.title),
            time_label: parse_hhmm(&item.time).map(label_minutes).unwrap_or_default(),
            subtitle: None,
            sort_minutes: parse_hhmm(&item.time).unwrap_or(0) as i64,
        });
    }

    // ---- water -----------------------------------------------------------
    data.water.roll_day();
    if data.water.enabled {
        let every = (data.water.every_minutes.max(5) as i64) * 60;
        let target = data
            .water
            .snoozed_until
            .unwrap_or_else(|| data.water.last_fired.map(|t| t + every).unwrap_or(now));
        if now >= target {
            data.water.last_fired = Some(now);
            data.water.snoozed_until = None;
            out.push(DueItem {
                id: "water".into(),
                kind: ItemKind::Water,
                title: "💧 Water break!".into(),
                time_label: "Now".into(),
                subtitle: Some(format!("{} so far today.", data.water.count_today)),
                sort_minutes: minutes_now() as i64,
            });
        }
    }

    // ---- goals -----------------------------------------------------------
    for goal in data.goals.iter_mut() {
        if !goal.active || goal.today_action.trim().is_empty() {
            continue;
        }
        let Some(time) = goal.today_time.clone() else { continue };
        let Some(target) = timestamp_for(&today, &time) else { continue };

        if let Some(fired) = goal.fired_at {
            if fired >= target {
                continue;
            }
        }
        if now < target || now - target > GRACE_SECONDS {
            continue;
        }

        goal.fired_at = Some(now);
        out.push(DueItem {
            id: goal.id.clone(),
            kind: ItemKind::Goal,
            title: format!("{} {}", goal.emoji, goal.today_action),
            time_label: parse_hhmm(&time).map(label_minutes).unwrap_or_default(),
            subtitle: Some(format!("Toward: {}", goal.title)),
            sort_minutes: parse_hhmm(&time).unwrap_or(0) as i64,
        });
    }

    // ---- the weekly check-in, Sunday evening, once -------------------------
    if weekday_now() == 7 && minutes_now() >= 18 * 60 {
        let week = week_key();
        if data.last_weekly_review.as_deref() != Some(&week) {
            data.last_weekly_review = Some(week);
            let (done, total) = week_totals(data);
            out.push(DueItem {
                id: "review".into(),
                kind: ItemKind::Review,
                title: "Your week with Buddy 👋".into(),
                time_label: "Weekly".into(),
                subtitle: Some(format!("{done} / {total} tasks completed.")),
                sort_minutes: 24 * 60,
            });
        }
    }

    out.sort_by_key(|i| i.sort_minutes);
    out
}

/// A stable key for "which week is it", used to fire the review only once.
pub fn week_key() -> String {
    use chrono::{Datelike, Local};
    let now = Local::now();
    let iso = now.iso_week();
    format!("{}-W{:02}", iso.year(), iso.week())
}

fn week_totals(data: &AppData) -> (u32, u32) {
    let mut done = 0;
    let mut total = 0;
    for log in data.history.iter().rev().take(7) {
        done += log.tasks_done;
        total += log.tasks_total;
    }
    for t in data.tasks.iter().filter(|t| t.is_today()) {
        total += 1;
        if t.done {
            done += 1;
        }
    }
    (done, total)
}

/// Closes out the previous day and re-arms anything that repeats.
pub fn rollover(data: &mut AppData) {
    let today = today_string();
    if data.last_rollover.as_deref() == Some(&today) {
        return;
    }

    if let Some(prev) = data.last_rollover.clone() {
        let tasks_total = data.tasks.iter().filter(|t| t.date == prev).count() as u32;
        let tasks_done = data
            .tasks
            .iter()
            .filter(|t| t.date == prev && t.done)
            .count() as u32;
        let routine_total = data.routine.iter().filter(|r| r.enabled).count() as u32;
        let routine_done = data
            .routine
            .iter()
            .filter(|r| r.completed_on.as_deref() == Some(prev.as_str()))
            .count() as u32;

        data.history.push(DayLog {
            date: prev,
            tasks_done,
            tasks_total,
            routine_done,
            routine_total,
        });
        if data.history.len() > 120 {
            let excess = data.history.len() - 120;
            data.history.drain(0..excess);
        }
    }

    // Repeating tasks reappear on today's date; finished one-offs are cleared.
    let weekday = weekday_now();
    let mut next: Vec<Task> = Vec::new();
    for mut task in data.tasks.drain(..) {
        match task.repeat {
            Repeat::None => {
                if task.open() || task.date == today {
                    next.push(task);
                }
            }
            Repeat::Daily => {
                task.date = today.clone();
                reset(&mut task);
                next.push(task);
            }
            Repeat::Weekdays => {
                if (1..=5).contains(&weekday) {
                    task.date = today.clone();
                    reset(&mut task);
                }
                next.push(task);
            }
            Repeat::Weekly => {
                if let Some(ts) = timestamp_for(&task.date, &task.time) {
                    if ts < now_ts() {
                        if let Some(d) =
                            chrono::NaiveDate::parse_from_str(&task.date, "%Y-%m-%d").ok()
                        {
                            task.date = (d + chrono::Duration::days(7))
                                .format("%Y-%m-%d")
                                .to_string();
                            reset(&mut task);
                        }
                    }
                }
                next.push(task);
            }
        }
    }
    data.tasks = next;

    for item in data.routine.iter_mut() {
        item.snoozed_until = None;
        item.fired_at = None;
    }
    data.water.roll_day();
    data.water.snoozed_until = None;
    for goal in data.goals.iter_mut() {
        goal.fired_at = None;
    }

    data.last_rollover = Some(today);
}

fn reset(task: &mut Task) {
    task.done = false;
    task.skipped = false;
    task.fired_at = None;
    task.snoozed_until = None;
}
