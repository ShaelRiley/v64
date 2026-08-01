#[path = "../../v64-core/src/renderer.rs"]
mod renderer;

use std::sync::OnceLock;

fn fixture() -> &'static renderer::Raster {
    static FIXTURE: OnceLock<renderer::Raster> = OnceLock::new();
    FIXTURE.get_or_init(|| {
        renderer::conformance_raster().unwrap_or_else(|_| renderer::Raster {
            width: 0,
            height: 0,
            rgba: Vec::new(),
        })
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn v64_renderer_abi_version() -> u32 {
    1
}

#[unsafe(no_mangle)]
pub extern "C" fn v64_renderer_fixture_width() -> u32 {
    u32::try_from(fixture().width).unwrap_or(0)
}

#[unsafe(no_mangle)]
pub extern "C" fn v64_renderer_fixture_height() -> u32 {
    u32::try_from(fixture().height).unwrap_or(0)
}

#[unsafe(no_mangle)]
pub extern "C" fn v64_renderer_fixture_len() -> u32 {
    u32::try_from(fixture().rgba.len()).unwrap_or(0)
}

#[unsafe(no_mangle)]
pub extern "C" fn v64_renderer_fixture_byte(index: u32) -> u32 {
    fixture()
        .rgba
        .get(index as usize)
        .map_or(256, |value| u32::from(*value))
}

#[unsafe(no_mangle)]
pub extern "C" fn v64_renderer_fixture_fnv_lo() -> u32 {
    renderer::fnv1a64(&fixture().rgba) as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn v64_renderer_fixture_fnv_hi() -> u32 {
    (renderer::fnv1a64(&fixture().rgba) >> 32) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exported_fixture_is_complete_and_stable() {
        assert_eq!(v64_renderer_abi_version(), 1);
        assert_eq!(v64_renderer_fixture_width(), 64);
        assert_eq!(v64_renderer_fixture_height(), 128);
        assert_eq!(v64_renderer_fixture_len(), 32_768);
        assert!(v64_renderer_fixture_byte(0) <= 255);
        assert!(v64_renderer_fixture_byte(v64_renderer_fixture_len() - 1) <= 255);
        assert_eq!(v64_renderer_fixture_byte(v64_renderer_fixture_len()), 256);
        assert_eq!(
            v64_renderer_fixture_byte(v64_renderer_fixture_len() + 1),
            256
        );
        assert_eq!(v64_renderer_fixture_byte(u32::MAX), 256);
        let hash = u64::from(v64_renderer_fixture_fnv_lo())
            | (u64::from(v64_renderer_fixture_fnv_hi()) << 32);
        assert_eq!(hash, renderer::fnv1a64(&fixture().rgba));
    }
}
