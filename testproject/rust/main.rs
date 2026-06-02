pub mod traits;
pub mod models;
pub mod utils;

use models::UserProfile;
use traits::{Printable, CustomId};

fn main() {
    let id = CustomId { uuid: String::from("1234") };
    let profile = UserProfile { id, name: String::from("Alice") };
    let _settings = std::fs::read_to_string("app.yaml").unwrap_or_default();
    let _template = include_str!("index.html");
    
    profile.print_info();
    handle_profile(&profile);
}

// [type_usage] UserProfile used as function parameter
fn handle_profile(profile: &UserProfile) {
    println!("Handling profile");
}
