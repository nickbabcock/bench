use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn bump_allocation(corpus: &str, iterations: usize) -> usize {
    let bump: bump_scope::Bump = bump_scope::Bump::new();

    let mut data = bump_scope::BumpVec::new_in(&bump);
    for _ in 0..iterations {
        let mut new_data = bump_scope::BumpVec::new_in(&bump);
        for _ in 0..5 {
            new_data.push(bump.alloc_str(corpus));
        }
        data.push(new_data);
    }
    data.len()
}
