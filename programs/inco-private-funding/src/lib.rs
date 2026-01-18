use anchor_lang::prelude::*;

declare_id!("9SUAHZ5CLyv6BdfGQLdb15KE1DanR9m6TdqHbq7ZaQWG");
mod instructions;
mod state;
use instructions::deposit::*;
use instructions::initialize_vault::*;
#[program]
pub mod inco_private_funding {

    use super::*;
    pub fn initialize<'info>(
        ctx: Context<'_, '_, '_, 'info, InitializeVault<'info>>,
    ) -> Result<()> {
        initialize_vault(ctx)?;
        Ok(())
    }
    pub fn deposit<'info>(
        ctx: Context<'_, '_, '_, 'info, Deposit<'info>>,
        amount: Vec<u8>,
    ) -> Result<()> {
        deposit_vault(ctx, amount)?;
        Ok(())
    }
}

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
    #[msg("Fixed supply")]
    FixedSupply,
    #[msg("Account already in use")]
    AlreadyInUse,
    #[msg("Invalid number of provided signers")]
    InvalidNumberOfProvidedSigners,
    #[msg("Invalid number of required signers")]
    InvalidNumberOfRequiredSigners,
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
    #[msg("Mint cannot freeze")]
    MintCannotFreeze,
    #[msg("Account frozen")]
    AccountFrozen,
    #[msg("Mint decimals mismatch")]
    MintDecimalsMismatch,
    #[msg("Non-native not supported")]
    NonNativeNotSupported,
}
