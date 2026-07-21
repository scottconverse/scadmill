use serde::Serialize;
use thiserror::Error;

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bounds3D {
    pub min: [f32; 3],
    pub max: [f32; 3],
    pub size: [f32; 3],
}

#[derive(Clone, Debug, PartialEq)]
pub struct ParsedStl {
    pub triangle_count: u32,
    pub bounds: Bounds3D,
    pub volume_mm3: f64,
}

#[derive(Debug, Error, PartialEq)]
pub enum StlError {
    #[error("binary STL is {actual} bytes; at least 84 bytes are required")]
    TooShort { actual: usize },
    #[error("binary STL contains no triangles")]
    Empty,
    #[error(
        "binary STL is {actual} bytes; {expected} bytes are required for {triangles} triangles"
    )]
    LengthMismatch {
        actual: usize,
        expected: usize,
        triangles: u32,
    },
    #[error("binary STL triangle {triangle} contains a non-finite coordinate")]
    NonFinite { triangle: u32 },
}

const HEADER_BYTES: usize = 84;
const TRIANGLE_BYTES: usize = 50;
const NORMAL_BYTES: usize = 12;
const COORDINATES_PER_TRIANGLE: usize = 9;

pub fn parse_binary_stl(bytes: &[u8]) -> Result<ParsedStl, StlError> {
    if bytes.len() < HEADER_BYTES {
        return Err(StlError::TooShort {
            actual: bytes.len(),
        });
    }

    let triangle_count = u32::from_le_bytes(bytes[80..84].try_into().expect("fixed-width slice"));
    if triangle_count == 0 {
        return Err(StlError::Empty);
    }

    let expected = HEADER_BYTES + triangle_count as usize * TRIANGLE_BYTES;
    if bytes.len() != expected {
        return Err(StlError::LengthMismatch {
            actual: bytes.len(),
            expected,
            triangles: triangle_count,
        });
    }

    let mut min = [f32::INFINITY; 3];
    let mut max = [f32::NEG_INFINITY; 3];
    let mut reference = None;
    let mut signed_sixfold_volume = 0.0_f64;
    let mut compensation = 0.0_f64;
    for triangle in 0..triangle_count as usize {
        let vertices = HEADER_BYTES + triangle * TRIANGLE_BYTES + NORMAL_BYTES;
        let mut triangle_vertices = [[0.0_f64; 3]; 3];
        for coordinate in 0..COORDINATES_PER_TRIANGLE {
            let offset = vertices + coordinate * 4;
            let value = f32::from_le_bytes(
                bytes[offset..offset + 4]
                    .try_into()
                    .expect("validated STL length"),
            );
            if !value.is_finite() {
                return Err(StlError::NonFinite {
                    triangle: triangle as u32 + 1,
                });
            }

            let axis = coordinate % 3;
            triangle_vertices[coordinate / 3][axis] = f64::from(value);
            min[axis] = min[axis].min(value);
            max[axis] = max[axis].max(value);
        }
        let origin = *reference.get_or_insert(triangle_vertices[0]);
        let translated = triangle_vertices.map(|vertex| {
            [
                vertex[0] - origin[0],
                vertex[1] - origin[1],
                vertex[2] - origin[2],
            ]
        });
        let [a, b, c] = translated;
        let term = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0])
            + a[2] * (b[0] * c[1] - b[1] * c[0]);
        let corrected = term - compensation;
        let next = signed_sixfold_volume + corrected;
        compensation = (next - signed_sixfold_volume) - corrected;
        signed_sixfold_volume = next;
    }

    Ok(ParsedStl {
        triangle_count,
        bounds: Bounds3D {
            min,
            max,
            size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
        },
        volume_mm3: signed_sixfold_volume.abs() / 6.0,
    })
}

#[cfg(test)]
mod tests {
    use super::{StlError, parse_binary_stl};

    fn one_triangle() -> Vec<u8> {
        let mut bytes = vec![0_u8; 84 + 50];
        bytes[80..84].copy_from_slice(&1_u32.to_le_bytes());
        let vertices = [[-5.0_f32, 2.0, -1.0], [5.0, 2.0, -1.0], [5.0, 22.0, 29.0]];
        for (vertex_index, vertex) in vertices.iter().enumerate() {
            for (axis, coordinate) in vertex.iter().enumerate() {
                let offset = 84 + 12 + vertex_index * 12 + axis * 4;
                bytes[offset..offset + 4].copy_from_slice(&coordinate.to_le_bytes());
            }
        }
        bytes
    }

    fn tetrahedron() -> Vec<u8> {
        let origin = [10.0_f32, 20.0, 30.0];
        let point = |x: f32, y: f32, z: f32| [origin[0] + x, origin[1] + y, origin[2] + z];
        let v0 = point(0.0, 0.0, 0.0);
        let v1 = point(1.0, 0.0, 0.0);
        let v2 = point(0.0, 1.0, 0.0);
        let v3 = point(0.0, 0.0, 1.0);
        let triangles = [v0, v2, v1, v0, v1, v3, v0, v3, v2, v1, v2, v3];
        let mut bytes = vec![0_u8; 84 + 4 * 50];
        bytes[80..84].copy_from_slice(&4_u32.to_le_bytes());
        for (index, vertex) in triangles.iter().enumerate() {
            let triangle = index / 3;
            let vertex_in_triangle = index % 3;
            for (axis, coordinate) in vertex.iter().enumerate() {
                let offset = 84 + triangle * 50 + 12 + vertex_in_triangle * 12 + axis * 4;
                bytes[offset..offset + 4].copy_from_slice(&coordinate.to_le_bytes());
            }
        }
        bytes
    }

    #[test]
    fn parses_triangle_count_and_bounds() {
        let parsed = parse_binary_stl(&one_triangle()).expect("fixture should parse");
        assert_eq!(parsed.triangle_count, 1);
        assert_eq!(parsed.bounds.min, [-5.0, 2.0, -1.0]);
        assert_eq!(parsed.bounds.max, [5.0, 22.0, 29.0]);
    }

    #[test]
    fn derives_translation_invariant_enclosed_volume() {
        let parsed = parse_binary_stl(&tetrahedron()).expect("fixture should parse");
        assert!((parsed.volume_mm3 - 1.0 / 6.0).abs() < 1e-12);
    }

    #[test]
    fn rejects_short_truncated_and_non_finite_payloads() {
        assert_eq!(
            parse_binary_stl(&[0_u8; 83]),
            Err(StlError::TooShort { actual: 83 })
        );
        let mut truncated = one_triangle();
        truncated.pop();
        assert!(matches!(
            parse_binary_stl(&truncated),
            Err(StlError::LengthMismatch { .. })
        ));
        let mut non_finite = one_triangle();
        non_finite[96..100].copy_from_slice(&f32::NAN.to_le_bytes());
        assert_eq!(
            parse_binary_stl(&non_finite),
            Err(StlError::NonFinite { triangle: 1 })
        );
    }
}
