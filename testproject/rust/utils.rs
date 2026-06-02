pub fn do_something() {
    println!("Doing something in Rust utils!");
}

pub struct Helper {
    pub value: i32,
}

impl Helper {
    pub fn new(val: i32) -> Self {
        Helper { value: val }
    }
    
    pub fn process(&self) -> i32 {
        self.value * 2
    }
}
