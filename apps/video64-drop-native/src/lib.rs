#![forbid(unsafe_code)]

use std::cmp::Ordering;

use serde_json::{Value, json};

pub const SHELL_REPORT_FORMAT: &str = "VIDEO64-DROP-NATIVE-SHELL-1";
pub const SHELL_ENCODE_REPORT_FORMAT: &str = "VIDEO64-DROP-NATIVE-ENCODE-1";

pub const CADENCES: [&str; 11] = [
    "0.10", "0.5", "1", "3", "6", "12", "15", "24", "30", "48", "60",
];
pub const COLUMNS: [u16; 7] = [40, 60, 80, 100, 120, 160, 200];
pub const PALETTES: [u16; 14] = [2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 256];
pub const GLYPH_BUDGETS: [u8; 2] = [32, 64];
pub const PROFILES: [&str; 3] = ["smallest", "balanced", "clearest"];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Control {
    Cadence,
    Columns,
    Palette,
    Glyphs,
    Profile,
}

impl Control {
    pub const ALL: [Self; 5] = [
        Self::Cadence,
        Self::Columns,
        Self::Palette,
        Self::Glyphs,
        Self::Profile,
    ];

    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::Cadence => "CADENCE",
            Self::Columns => "COLUMNS",
            Self::Palette => "PALETTE",
            Self::Glyphs => "GLYPHS",
            Self::Profile => "PROFILE",
        }
    }

    #[must_use]
    pub fn next(self) -> Self {
        let index = Self::ALL
            .iter()
            .position(|candidate| *candidate == self)
            .unwrap_or(0);
        Self::ALL[(index + 1) % Self::ALL.len()]
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShellSettings {
    cadence_index: usize,
    columns_index: usize,
    palette_index: usize,
    glyphs_index: usize,
    profile_index: usize,
}

impl Default for ShellSettings {
    fn default() -> Self {
        Self {
            cadence_index: 7,
            columns_index: 2,
            palette_index: 8,
            glyphs_index: 0,
            profile_index: 1,
        }
    }
}

impl ShellSettings {
    #[must_use]
    pub const fn cadence(&self) -> &'static str {
        CADENCES[self.cadence_index]
    }

    #[must_use]
    pub const fn columns(&self) -> u16 {
        COLUMNS[self.columns_index]
    }

    #[must_use]
    pub const fn palette(&self) -> u16 {
        PALETTES[self.palette_index]
    }

    #[must_use]
    pub const fn glyphs(&self) -> u8 {
        GLYPH_BUDGETS[self.glyphs_index]
    }

    #[must_use]
    pub const fn profile(&self) -> &'static str {
        PROFILES[self.profile_index]
    }

    pub fn adjust(&mut self, control: Control, direction: i8) -> bool {
        let (index, length) = match control {
            Control::Cadence => (&mut self.cadence_index, CADENCES.len()),
            Control::Columns => (&mut self.columns_index, COLUMNS.len()),
            Control::Palette => (&mut self.palette_index, PALETTES.len()),
            Control::Glyphs => (&mut self.glyphs_index, GLYPH_BUDGETS.len()),
            Control::Profile => (&mut self.profile_index, PROFILES.len()),
        };
        let before = *index;
        match direction.cmp(&0) {
            Ordering::Less => *index = index.saturating_sub(1),
            Ordering::Greater => *index = (*index + 1).min(length - 1),
            Ordering::Equal => {}
        }
        before != *index
    }

    #[must_use]
    pub fn value_label(&self, control: Control) -> String {
        match control {
            Control::Cadence => format!("{} FPS", self.cadence()),
            Control::Columns => self.columns().to_string(),
            Control::Palette => format!("{} COLORS", self.palette()),
            Control::Glyphs => self.glyphs().to_string(),
            Control::Profile => self.profile().to_ascii_uppercase(),
        }
    }

    #[must_use]
    pub fn cli_arguments(&self) -> Vec<String> {
        vec![
            "--fps".to_owned(),
            self.cadence().to_owned(),
            "--columns".to_owned(),
            self.columns().to_string(),
            "--palette".to_owned(),
            self.palette().to_string(),
            "--glyphs".to_owned(),
            self.glyphs().to_string(),
            "--profile".to_owned(),
            self.profile().to_owned(),
        ]
    }

    #[must_use]
    pub fn to_json(&self) -> Value {
        json!({
            "fps": self.cadence(),
            "columns": self.columns(),
            "palette": self.palette(),
            "glyphs": self.glyphs(),
            "profile": self.profile(),
        })
    }
}

#[must_use]
pub fn shell_capabilities() -> Value {
    json!({
        "desktopShell": true,
        "linuxFirst": true,
        "dragAndDrop": true,
        "startupFileArguments": true,
        "keyboardControls": true,
        "queue": true,
        "sourceAnalysis": true,
        "videoEncoding": true,
        "audioEncoding": false,
        "outputVerification": true,
        "decodedPreview": false,
        "sampledSizeEstimator": false,
        "particleLighting": false,
        "packagedApplication": false,
    })
}

#[must_use]
pub fn control_vocabulary() -> Value {
    json!({
        "cadences": CADENCES,
        "columns": COLUMNS,
        "palettes": PALETTES,
        "glyphBudgets": GLYPH_BUDGETS,
        "profiles": PROFILES,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_shell_defaults_match_video64_drop() {
        let settings = ShellSettings::default();
        assert_eq!(settings.cadence(), "24");
        assert_eq!(settings.columns(), 80);
        assert_eq!(settings.palette(), 32);
        assert_eq!(settings.glyphs(), 32);
        assert_eq!(settings.profile(), "balanced");
        assert_eq!(
            settings.cli_arguments(),
            [
                "--fps",
                "24",
                "--columns",
                "80",
                "--palette",
                "32",
                "--glyphs",
                "32",
                "--profile",
                "balanced",
            ]
        );
    }

    #[test]
    fn discrete_controls_are_bounded() {
        let mut settings = ShellSettings::default();
        for _ in 0..20 {
            settings.adjust(Control::Cadence, -1);
            settings.adjust(Control::Columns, -1);
            settings.adjust(Control::Palette, -1);
            settings.adjust(Control::Glyphs, -1);
            settings.adjust(Control::Profile, -1);
        }
        assert_eq!(settings.cadence(), "0.10");
        assert_eq!(settings.columns(), 40);
        assert_eq!(settings.palette(), 2);
        assert_eq!(settings.glyphs(), 32);
        assert_eq!(settings.profile(), "smallest");

        for _ in 0..20 {
            settings.adjust(Control::Cadence, 1);
            settings.adjust(Control::Columns, 1);
            settings.adjust(Control::Palette, 1);
            settings.adjust(Control::Glyphs, 1);
            settings.adjust(Control::Profile, 1);
        }
        assert_eq!(settings.cadence(), "60");
        assert_eq!(settings.columns(), 200);
        assert_eq!(settings.palette(), 256);
        assert_eq!(settings.glyphs(), 64);
        assert_eq!(settings.profile(), "clearest");
    }

    #[test]
    fn control_focus_order_is_stable() {
        let mut control = Control::Cadence;
        for expected in [
            Control::Columns,
            Control::Palette,
            Control::Glyphs,
            Control::Profile,
            Control::Cadence,
        ] {
            control = control.next();
            assert_eq!(control, expected);
        }
    }
}
