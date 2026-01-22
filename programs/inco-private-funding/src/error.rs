use anchor_lang::prelude::*;

#[error_code]
pub enum CustomError {
    #[msg("Lamport balance below rent-exempt threshold")]
    NotRentExempt,
    #[msg("Insufficient funds")]
    InsufficientFunds,
    #[msg("Invalid Mint")]
    InvalidMint,
    #[msg("Account not associated with this Mint")]
    MintMismatch,
    #[msg("Owner does not match")]
    OwnerMismatch,
    #[msg("Account already in use")]
    AlreadyInUse,
    #[msg("State is uninitialized")]
    UninitializedState,
    #[msg("Native tokens not supported")]
    NativeNotSupported,
    #[msg("Non-native account has balance")]
    NonNativeHasBalance,
    #[msg("Invalid instruction")]
    InvalidInstruction,
    #[msg("Invalid state")]
    InvalidState,
    #[msg("Overflow")]
    Overflow,
    #[msg("Authority type not supported")]
    AuthorityTypeNotSupported,
    #[msg("Mint decimals mismatch")]
    MintDecimalsMismatch,
    #[msg("Non-native not supported")]
    NonNativeNotSupported,
}
