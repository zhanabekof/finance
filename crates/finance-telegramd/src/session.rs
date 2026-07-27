use std::collections::HashMap;
use std::sync::Mutex;

use crate::parse::Kind;

#[derive(Debug, Clone)]
pub enum DialogState {
    /// Waiting for an inline category button. Kind is selected but unused until callback.
    #[allow(dead_code)]
    AwaitingCategory { kind: Kind },
    AwaitingAmount {
        kind: Kind,
        category_id: Option<i64>,
        category_name: String,
    },
}

/// In-memory dialog sessions keyed by Telegram chat id.
pub struct Sessions {
    inner: Mutex<HashMap<String, DialogState>>,
}

impl Sessions {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }

    pub fn get(&self, chat_id: &str) -> Option<DialogState> {
        self.inner
            .lock()
            .ok()?
            .get(chat_id)
            .cloned()
    }

    pub fn set(&self, chat_id: &str, state: DialogState) {
        if let Ok(mut map) = self.inner.lock() {
            map.insert(chat_id.to_string(), state);
        }
    }

    pub fn clear(&self, chat_id: &str) {
        if let Ok(mut map) = self.inner.lock() {
            map.remove(chat_id);
        }
    }
}
