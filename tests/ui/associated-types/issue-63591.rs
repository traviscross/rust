// check-pass

#![feature(associated_type_bounds)]

fn main() {}

trait Bar {
    type Assoc;
}

trait Thing {
    type Out;
    fn func() -> Self::Out;
}

struct AssocIsCopy;
impl Bar for AssocIsCopy {
    type Assoc = u8;
}

impl Thing for AssocIsCopy {
    type Out = impl Bar<Assoc: Copy>;

    fn func() -> Self::Out {
        AssocIsCopy
    }
}
