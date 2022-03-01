// Some ideas for future improvements:
// - Support replacing aliases which are used in expressions, e.g. `A::new()`.
// - "inline_alias_to_users" assist #10881.
// - Remove unused aliases if there are no longer any users, see inline_call.rs.

use hir::PathResolution;
use itertools::Itertools;
use std::collections::HashMap;
use syntax::{
    ast::{
        self,
        make::{self},
        HasGenericParams, HasName,
    },
    ted::{self},
    AstNode, NodeOrToken, SyntaxKind, SyntaxNode,
};

use crate::{
    assist_context::{AssistContext, Assists},
    AssistId, AssistKind,
};

// Assist: inline_type_alias
//
// Replace a type alias with its concrete type.
//
// ```
// type A<T = u32> = Vec<T>;
//
// fn main() {
//     let a: $0A;
// }
// ```
// ->
// ```
// type A<T = u32> = Vec<T>;
//
// fn main() {
//     let a: Vec<u32>;
// }
// ```
pub(crate) fn inline_type_alias(acc: &mut Assists, ctx: &AssistContext) -> Option<()> {
    let alias_instance = ctx.find_node_at_offset::<ast::PathType>()?;
    let alias = get_type_alias(&ctx, &alias_instance)?;
    let concrete_type = alias.ty()?;

    let replacement = if let Some(alias_generics) = alias.generic_param_list() {
        get_replacement_for_generic_alias(
            alias_instance.syntax().descendants().find_map(ast::GenericArgList::cast),
            alias_generics,
            &concrete_type,
        )?
    } else {
        concrete_type.to_string()
    };

    let target = alias_instance.syntax().text_range();

    acc.add(
        AssistId("inline_type_alias", AssistKind::RefactorInline),
        "Inline type alias",
        target,
        |builder| {
            builder.replace(target, replacement);
        },
    )
}

/// This doesn't attempt to ensure specified generics are compatible with those
/// required by the type alias, other than lifetimes which must either all be
/// specified or all omitted. It will replace TypeArgs with ConstArgs and vice
/// versa if they're in the wrong position. It supports partially specified
/// generics.
///
/// 1. Map the provided instance's generic args to the type alias's generic
///    params:
///
///    ```
///    type A<'a, const N: usize, T = u64> = &'a [T; N];
///          ^ alias generic params
///    let a: A<100>;
///            ^ instance generic args
///    ```
///
///    generic['a] = '_ due to omission
///    generic[N] = 100 due to the instance arg
///    generic[T] = u64 due to the default param
///
/// 2. Copy the concrete type and substitute in each found mapping:
///
///    &'_ [u64; 100]
///
/// 3. Remove wildcard lifetimes entirely:
///
///    &[u64; 100]
fn get_replacement_for_generic_alias(
    instance_generic_args_list: Option<ast::GenericArgList>,
    alias_generics: ast::GenericParamList,
    concrete_type: &ast::Type,
) -> Option<String> {
    if alias_generics.generic_params().count() == 0 {
        cov_mark::hit!(no_generics_params);
        return None;
    }

    let mut lifetime_mappings = HashMap::<&str, ast::Lifetime>::new();
    let mut other_mappings = HashMap::<String, SyntaxNode>::new();

    let wildcard_lifetime = make::lifetime("'_");
    let alias_lifetimes = alias_generics.lifetime_params().map(|l| l.to_string()).collect_vec();
    for lifetime in &alias_lifetimes {
        lifetime_mappings.insert(lifetime, wildcard_lifetime.clone());
    }

    if let Some(ref instance_generic_args_list) = instance_generic_args_list {
        for (index, lifetime) in instance_generic_args_list
            .lifetime_args()
            .map(|arg| arg.lifetime().expect("LifetimeArg has a Lifetime"))
            .enumerate()
        {
            if index >= alias_lifetimes.len() {
                cov_mark::hit!(too_many_lifetimes);
                return None;
            }

            let key = &alias_lifetimes[index];

            lifetime_mappings.insert(key, lifetime);
        }
    }

    let instance_generics = generic_args_to_other_generics(instance_generic_args_list);
    let alias_generics = generic_param_list_to_other_generics(&alias_generics);

    if instance_generics.len() > alias_generics.len() {
        cov_mark::hit!(too_many_generic_args);
        return None;
    }

    // Any declaration generics that don't have a default value must have one
    // provided by the instance.
    for (i, declaration_generic) in alias_generics.iter().enumerate() {
        let key = declaration_generic.replacement_key();

        if let Some(instance_generic) = instance_generics.get(i) {
            other_mappings.insert(key, instance_generic.replacement_value()?);
        } else if let Some(value) = declaration_generic.replacement_value() {
            other_mappings.insert(key, value);
        } else {
            cov_mark::hit!(missing_replacement_param);
            return None;
        }
    }

    let updated_concrete_type = concrete_type.clone_for_update();
    let mut replacements = Vec::new();
    let mut removals = Vec::new();

    for syntax in updated_concrete_type.syntax().descendants() {
        let syntax_string = syntax.to_string();
        let syntax_str = syntax_string.as_str();

        if syntax.kind() == SyntaxKind::LIFETIME {
            let new = lifetime_mappings.get(syntax_str).expect("lifetime is mapped");
            if new.text() == "'_" {
                removals.push(NodeOrToken::Node(syntax.clone()));

                if let Some(ws) = syntax.next_sibling_or_token() {
                    removals.push(ws.clone());
                }

                continue;
            }

            replacements.push((syntax.clone(), new.syntax().clone_for_update()));
        } else if let Some(replacement_syntax) = other_mappings.get(syntax_str) {
            let new_string = replacement_syntax.to_string();
            let new = if new_string == "_" {
                make::wildcard_pat().syntax().clone_for_update()
            } else {
                replacement_syntax.clone_for_update()
            };

            replacements.push((syntax.clone(), new));
        }
    }

    for (old, new) in replacements {
        ted::replace(old, new);
    }

    for syntax in removals {
        ted::remove(syntax);
    }

    Some(updated_concrete_type.to_string())
}

fn get_type_alias(ctx: &AssistContext, path: &ast::PathType) -> Option<ast::TypeAlias> {
    let resolved_path = ctx.sema.resolve_path(&path.path()?)?;

    // We need the generics in the correct order to be able to map any provided
    // instance generics to declaration generics. The `hir::TypeAlias` doesn't
    // keep the order, so we must get the `ast::TypeAlias` from the hir
    // definition.
    if let PathResolution::Def(hir::ModuleDef::TypeAlias(ta)) = resolved_path {
        ast::TypeAlias::cast(ctx.sema.source(ta)?.syntax().value.clone())
    } else {
        None
    }
}

enum OtherGeneric {
    ConstArg(ast::ConstArg),
    TypeArg(ast::TypeArg),
    ConstParam(ast::ConstParam),
    TypeParam(ast::TypeParam),
}

impl OtherGeneric {
    fn replacement_key(&self) -> String {
        // Only params are used as replacement keys.
        match self {
            OtherGeneric::ConstArg(_) => unreachable!(),
            OtherGeneric::TypeArg(_) => unreachable!(),
            OtherGeneric::ConstParam(cp) => cp.name().expect("ConstParam has a name").to_string(),
            OtherGeneric::TypeParam(tp) => tp.name().expect("TypeParam has a name").to_string(),
        }
    }

    fn replacement_value(&self) -> Option<SyntaxNode> {
        Some(match self {
            OtherGeneric::ConstArg(ca) => ca.expr()?.syntax().clone(),
            OtherGeneric::TypeArg(ta) => ta.syntax().clone(),
            OtherGeneric::ConstParam(cp) => cp.default_val()?.syntax().clone(),
            OtherGeneric::TypeParam(tp) => tp.default_type()?.syntax().clone(),
        })
    }
}

fn generic_param_list_to_other_generics(generics: &ast::GenericParamList) -> Vec<OtherGeneric> {
    let mut others = Vec::new();

    for param in generics.generic_params() {
        match param {
            ast::GenericParam::LifetimeParam(_) => {}
            ast::GenericParam::ConstParam(cp) => {
                others.push(OtherGeneric::ConstParam(cp));
            }
            ast::GenericParam::TypeParam(tp) => others.push(OtherGeneric::TypeParam(tp)),
        }
    }

    others
}

fn generic_args_to_other_generics(generics: Option<ast::GenericArgList>) -> Vec<OtherGeneric> {
    let mut others = Vec::new();

    // It's fine for there to be no instance generics because the declaration
    // might have default values or they might be inferred.
    if let Some(generics) = generics {
        for arg in generics.generic_args() {
            match arg {
                ast::GenericArg::TypeArg(ta) => {
                    others.push(OtherGeneric::TypeArg(ta));
                }
                ast::GenericArg::ConstArg(ca) => {
                    others.push(OtherGeneric::ConstArg(ca));
                }
                _ => {}
            }
        }
    }

    others
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::tests::{check_assist, check_assist_not_applicable};

    #[test]
    fn empty_generic_params() {
        cov_mark::check!(no_generics_params);
        check_assist_not_applicable(
            inline_type_alias,
            r#"
type A<> = T;
fn main() {
    let a: $0A<u32>;
}
            "#,
        );
    }

    #[test]
    fn too_many_generic_args() {
        cov_mark::check!(too_many_generic_args);
        check_assist_not_applicable(
            inline_type_alias,
            r#"
type A<T> = T;
fn main() {
    let a: $0A<u32, u64>;
}
            "#,
        );
    }

    #[test]
    fn too_many_lifetimes() {
        cov_mark::check!(too_many_lifetimes);
        check_assist_not_applicable(
            inline_type_alias,
            r#"
type A<'a> = &'a &'b u32;
fn f<'a>() {
    let a: $0A<'a, 'b> = 0;
}
"#,
        );
    }

    // This must be supported in order to support "inline_alias_to_users" or
    // whatever it will be called.
    #[test]
    fn alias_as_expression_ignored() {
        check_assist_not_applicable(
            inline_type_alias,
            r#"
type A = Vec<u32>;
fn main() {
    let a: A = $0A::new();
}
"#,
        );
    }

    #[test]
    fn primitive_arg() {
        check_assist(
            inline_type_alias,
            r#"
type A<T> = T;
fn main() {
    let a: $0A<u32> = 0;
}
"#,
            r#"
type A<T> = T;
fn main() {
    let a: u32 = 0;
}
"#,
        );
    }

    #[test]
    fn no_generic_replacements() {
        check_assist(
            inline_type_alias,
            r#"
type A = Vec<u32>;
fn main() {
    let a: $0A;
}
"#,
            r#"
type A = Vec<u32>;
fn main() {
    let a: Vec<u32>;
}
"#,
        );
    }

    #[test]
    fn param_expression() {
        check_assist(
            inline_type_alias,
            r#"
type A<const N: usize = { 1 }> = [u32; N];
fn main() {
    let a: $0A;
}
"#,
            r#"
type A<const N: usize = { 1 }> = [u32; N];
fn main() {
    let a: [u32; { 1 }];
}
"#,
        );
    }

    #[test]
    fn param_default_value() {
        check_assist(
            inline_type_alias,
            r#"
type A<const N: usize = 1> = [u32; N];
fn main() {
    let a: $0A;
}
"#,
            r#"
type A<const N: usize = 1> = [u32; N];
fn main() {
    let a: [u32; 1];
}
"#,
        );
    }

    #[test]
    fn all_param_types() {
        check_assist(
            inline_type_alias,
            r#"
struct Struct<const C: usize>;
type A<'inner1, 'outer1, Outer1, const INNER1: usize, Inner1: Clone, const OUTER1: usize> = (Struct<INNER1>, Struct<OUTER1>, Outer1, &'inner1 (), Inner1, &'outer1 ());
fn foo<'inner2, 'outer2, Outer2, const INNER2: usize, Inner2, const OUTER2: usize>() {
    let a: $0A<'inner2, 'outer2, Outer2, INNER2, Inner2, OUTER2>;
}
"#,
            r#"
struct Struct<const C: usize>;
type A<'inner1, 'outer1, Outer1, const INNER1: usize, Inner1: Clone, const OUTER1: usize> = (Struct<INNER1>, Struct<OUTER1>, Outer1, &'inner1 (), Inner1, &'outer1 ());
fn foo<'inner2, 'outer2, Outer2, const INNER2: usize, Inner2, const OUTER2: usize>() {
    let a: (Struct<INNER2>, Struct<OUTER2>, Outer2, &'inner2 (), Inner2, &'outer2 ());
}
"#,
        );
    }

    #[test]
    fn omitted_lifetimes() {
        check_assist(
            inline_type_alias,
            r#"
type A<'l, 'r> = &'l &'r u32;
fn main() {
    let a: $0A;
}
"#,
            r#"
type A<'l, 'r> = &'l &'r u32;
fn main() {
    let a: &&u32;
}
"#,
        );
    }

    #[test]
    fn omitted_type() {
        check_assist(
            inline_type_alias,
            r#"
type A<'r, 'l, T = u32> = &'l std::collections::HashMap<&'r str, T>;
fn main() {
    let a: $0A<'_, '_>;
}
"#,
            r#"
type A<'r, 'l, T = u32> = &'l std::collections::HashMap<&'r str, T>;
fn main() {
    let a: &std::collections::HashMap<&str, u32>;
}
"#,
        );
    }

    #[test]
    fn omitted_everything() {
        check_assist(
            inline_type_alias,
            r#"
type A<'r, 'l, T = u32> = &'l std::collections::HashMap<&'r str, T>;
fn main() {
    let v = std::collections::HashMap<&str, u32>;
    let a: $0A = &v;
}
"#,
            r#"
type A<'r, 'l, T = u32> = &'l std::collections::HashMap<&'r str, T>;
fn main() {
    let v = std::collections::HashMap<&str, u32>;
    let a: &std::collections::HashMap<&str, u32> = &v;
}
"#,
        );
    }

    // This doesn't actually cause the GenericArgsList to contain a AssocTypeArg.
    #[test]
    fn arg_associated_type() {
        check_assist(
            inline_type_alias,
            r#"
trait Tra { type Assoc; fn a(); }
struct Str {}
impl Tra for Str {
    type Assoc = u32;
    fn a() {
        type A<T> = Vec<T>;
        let a: $0A<Self::Assoc>;
    }
}
"#,
            r#"
trait Tra { type Assoc; fn a(); }
struct Str {}
impl Tra for Str {
    type Assoc = u32;
    fn a() {
        type A<T> = Vec<T>;
        let a: Vec<Self::Assoc>;
    }
}
"#,
        );
    }

    #[test]
    fn param_default_associated_type() {
        check_assist(
            inline_type_alias,
            r#"
trait Tra { type Assoc; fn a() }
struct Str {}
impl Tra for Str {
    type Assoc = u32;
    fn a() {
        type A<T = Self::Assoc> = Vec<T>;
        let a: $0A;
    }
}
"#,
            r#"
trait Tra { type Assoc; fn a() }
struct Str {}
impl Tra for Str {
    type Assoc = u32;
    fn a() {
        type A<T = Self::Assoc> = Vec<T>;
        let a: Vec<Self::Assoc>;
    }
}
"#,
        );
    }

    #[test]
    fn function_pointer() {
        check_assist(
            inline_type_alias,
            r#"
type A = fn(u32);
fn foo(a: u32) {}
fn main() {
    let a: $0A = foo;
}
"#,
            r#"
type A = fn(u32);
fn foo(a: u32) {}
fn main() {
    let a: fn(u32) = foo;
}
"#,
        );
    }

    #[test]
    fn closure() {
        check_assist(
            inline_type_alias,
            r#"
type A = Box<dyn FnOnce(u32) -> u32>;
fn main() {
    let a: $0A = Box::new(|_| 0);
}
"#,
            r#"
type A = Box<dyn FnOnce(u32) -> u32>;
fn main() {
    let a: Box<dyn FnOnce(u32) -> u32> = Box::new(|_| 0);
}
"#,
        );
    }

    // Type aliases can't be used in traits, but someone might use the assist to
    // fix the error.
    #[test]
    fn bounds() {
        check_assist(
            inline_type_alias,
            r#"type A = std::io::Write; fn f<T>() where T: $0A {}"#,
            r#"type A = std::io::Write; fn f<T>() where T: std::io::Write {}"#,
        );
    }

    #[test]
    fn function_parameter() {
        check_assist(
            inline_type_alias,
            r#"
type A = std::io::Write;
fn f(a: impl $0A) {}
"#,
            r#"
type A = std::io::Write;
fn f(a: impl std::io::Write) {}
"#,
        );
    }

    #[test]
    fn arg_expression() {
        check_assist(
            inline_type_alias,
            r#"
type A<const N: usize> = [u32; N];
fn main() {
    let a: $0A<{ 1 + 1 }>;
}
"#,
            r#"
type A<const N: usize> = [u32; N];
fn main() {
    let a: [u32; { 1 + 1 }];
}
"#,
        )
    }

    #[test]
    fn alias_instance_generic_path() {
        check_assist(
            inline_type_alias,
            r#"
type A<const N: usize> = [u32; N];
fn main() {
    let a: $0A<u32::MAX>;
}
"#,
            r#"
type A<const N: usize> = [u32; N];
fn main() {
    let a: [u32; u32::MAX];
}
"#,
        )
    }

    #[test]
    fn generic_type() {
        check_assist(
            inline_type_alias,
            r#"
type A = String;
fn f(a: Vec<$0A>) {}
"#,
            r#"
type A = String;
fn f(a: Vec<String>) {}
"#,
        );
    }

    #[test]
    fn missing_replacement_param() {
        cov_mark::check!(missing_replacement_param);
        check_assist_not_applicable(
            inline_type_alias,
            r#"
type A<U> = Vec<T>;
fn main() {
    let a: $0A;
}
"#,
        );
    }

    #[test]
    fn imported_external() {
        check_assist(
            inline_type_alias,
            r#"
mod foo {
    type A = String;
}
fn main() {
    use foo::A;
    let a: $0A;
}
"#,
            r#"
mod foo {
    type A = String;
}
fn main() {
    use foo::A;
    let a: String;
}
"#,
        );
    }
}
