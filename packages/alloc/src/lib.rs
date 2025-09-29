use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn allocation(corpus: &str, iterations: usize) -> usize {
    let mut data = Vec::new();

    for _ in 0..iterations {
        let mut new_data = Vec::new();
        for _ in 0..5 {
            new_data.push(String::from(corpus).into_boxed_str());
        }
        data.push(new_data);
    }

    data.len()
}

#[wasm_bindgen]
pub fn bump_allocation(corpus: &str, iterations: usize) -> usize {
    use bumpalo::{collections::Vec, Bump};

    let bump = Bump::with_capacity(
        ((std::mem::size_of::<&str>() * corpus.len() * iterations * 5)
            + (std::mem::size_of::<Vec<&str>>() * iterations)
            + std::mem::size_of::<Vec<Vec<&str>>>())
        .next_power_of_two(),
    );

    let mut data = Vec::new_in(&bump);
    for _ in 0..iterations {
        let mut new_data = Vec::new_in(&bump);
        for _ in 0..5 {
            new_data.push(bump.alloc_str(corpus));
        }
        data.push(new_data);
    }

    data.len()
}
