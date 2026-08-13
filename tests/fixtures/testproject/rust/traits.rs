pub trait Printable {
    fn print_info(&self);
}

pub struct CustomId {
    pub uuid: String,
}
