mod bot;
mod db;
mod money;
mod parse;
mod paths;
mod session;

fn main() {
    if let Err(err) = bot::run_forever() {
        eprintln!("finance-telegramd fatal: {err}");
        std::process::exit(1);
    }
}
