use crate::EngineError;
use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum ParamValue {
    Number(f64),
    Boolean(bool),
    String(String),
    Vector(Vec<f64>),
}

pub(crate) fn parameter_definitions(
    parameters: &BTreeMap<String, ParamValue>,
) -> Result<Vec<String>, EngineError> {
    parameters
        .iter()
        .map(|(name, value)| {
            if !valid_parameter_name(name) {
                return Err(EngineError::InvalidParameter {
                    name: name.clone(),
                    detail: "name must be an OpenSCAD identifier",
                });
            }
            Ok(format!("{name}={}", format_parameter_value(name, value)?))
        })
        .collect()
}

fn valid_parameter_name(name: &str) -> bool {
    let mut characters = name.chars();
    let Some(mut first) = characters.next() else {
        return false;
    };
    if first == '$' {
        let Some(special_start) = characters.next() else {
            return false;
        };
        first = special_start;
    }
    (first == '_' || first.is_ascii_alphabetic())
        && characters.all(|character| character == '_' || character.is_ascii_alphanumeric())
}

fn finite_number(name: &str, value: f64) -> Result<String, EngineError> {
    if value.is_finite() {
        Ok(value.to_string())
    } else {
        Err(EngineError::InvalidParameter {
            name: name.to_string(),
            detail: "numbers must be finite",
        })
    }
}

fn quoted_string(name: &str, value: &str) -> Result<String, EngineError> {
    let mut output = String::from("\"");
    for character in value.chars() {
        match character {
            '\\' => output.push_str("\\\\"),
            '"' => output.push_str("\\\""),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            control if control.is_control() => {
                return Err(EngineError::InvalidParameter {
                    name: name.to_string(),
                    detail: "strings contain an unsupported control character",
                });
            }
            other => output.push(other),
        }
    }
    output.push('"');
    Ok(output)
}

fn format_parameter_value(name: &str, value: &ParamValue) -> Result<String, EngineError> {
    match value {
        ParamValue::Number(number) => finite_number(name, *number),
        ParamValue::Boolean(boolean) => Ok(boolean.to_string()),
        ParamValue::String(string) => quoted_string(name, string),
        ParamValue::Vector(numbers) => {
            let values = numbers
                .iter()
                .map(|number| finite_number(name, *number))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(format!("[{}]", values.join(", ")))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{ParamValue, parameter_definitions};
    use std::collections::BTreeMap;

    #[test]
    fn formats_typed_parameter_definitions_in_stable_order() {
        let parameters = BTreeMap::from([
            ("size".to_string(), ParamValue::Number(20.0)),
            ("centered".to_string(), ParamValue::Boolean(true)),
            (
                "label".to_string(),
                ParamValue::String("quoted \"text\" \\ path".to_string()),
            ),
            (
                "points".to_string(),
                ParamValue::Vector(vec![1.0, -2.5, 3.0]),
            ),
        ]);

        assert_eq!(
            parameter_definitions(&parameters).expect("parameters should format"),
            vec![
                "centered=true",
                "label=\"quoted \\\"text\\\" \\\\ path\"",
                "points=[1, -2.5, 3]",
                "size=20",
            ]
        );
    }

    #[test]
    fn rejects_unsafe_parameter_names_and_non_finite_numbers() {
        for parameters in [
            BTreeMap::from([("size; echo(1)".to_string(), ParamValue::Number(1.0))]),
            BTreeMap::from([("size".to_string(), ParamValue::Number(f64::NAN))]),
            BTreeMap::from([("$".to_string(), ParamValue::Number(1.0))]),
        ] {
            assert!(parameter_definitions(&parameters).is_err());
        }
    }
}
