trait Foo {
    type Foo;
    fn bar();
}

impl Foo for () {
    type Foo = impl std::fmt::Debug;
    fn bar() {
        let x: Self::Foo = ();
        //~^ ERROR: mismatched types
    }
}

fn main() {}
