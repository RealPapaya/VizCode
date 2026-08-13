use crate::traits::{Printable, CustomId};

// [type_usage] CustomId used as a struct field type
pub struct UserProfile {
    pub id: CustomId,
    pub name: String,
}

// [implements] impl Trait for Type
impl Printable for UserProfile {
    fn print_info(&self) {
        println!("User: {}", self.name);
    }
}
