
// Stripe API types
export interface StripePaymentMethod {
  id: string;
  type: 'card';
  card: {
    brand: string;
    last4: string;
    exp_month: number;
    exp_year: number;
  };
  created: number;
}

export interface StripePaymentIntent {
  id: string;
  client_secret: string;
  amount: number;
  currency: string;
  status: 'requires_payment_method' | 'requires_confirmation' | 'requires_action' | 'processing' | 'requires_capture' | 'canceled' | 'succeeded';
}

export interface CreatePaymentMethodData {
  cardNumber: string;
  expiryDate: string;
  securityCode: string;
  cardholderName: string;
}

export interface StripeError {
  type: string;
  code?: string;
  message: string;
}

class StripeService {
  private publishableKey: string = '';
  private isInitialized: boolean = false;

  constructor() {
    // Read from Expo public env (must be prefixed EXPO_PUBLIC_ to reach client bundle)
    const key = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!key) {
      console.warn('[StripeService] Missing EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY env variable. Payments disabled.');
      this.publishableKey = '';
    } else {
      this.publishableKey = key;
    }
  }

  async initialize(): Promise<void> {
    try {
      if (this.isInitialized) return;
      
      // TODO: Initialize Stripe React Native SDK
      this.isInitialized = true;
  console.log('Stripe service initialized with publishable key prefix:', this.publishableKey ? this.publishableKey.slice(0, 10) + '…' : 'NONE');
    } catch (error) {
      console.error('Failed to initialize Stripe:', error);
      throw new Error('Failed to initialize payment service');
    }
  }

  async createPaymentMethod(cardData: CreatePaymentMethodData): Promise<StripePaymentMethod> {
    try {
      await this.initialize();
      
      // Mock implementation for now - would use Stripe SDK
      const paymentMethod: StripePaymentMethod = {
        id: `pm_mock_${Date.now()}`,
        type: 'card',
        card: {
          brand: this.detectCardBrand(cardData.cardNumber),
          last4: cardData.cardNumber.slice(-4),
          exp_month: parseInt(cardData.expiryDate.split('/')[0]),
          exp_year: parseInt('20' + cardData.expiryDate.split('/')[1]),
        },
        created: Math.floor(Date.now() / 1000),
      };

      // Simulate network delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      return paymentMethod;
    } catch (error) {
      console.error('Error creating payment method:', error);
      throw this.handleStripeError(error);
    }
  }

  async createPaymentIntent(amount: number, currency: string = 'usd'): Promise<StripePaymentIntent> {
    try {
      await this.initialize();
      
      // Mock implementation - would call your backend API
      const paymentIntent: StripePaymentIntent = {
        id: `pi_mock_${Date.now()}`,
        client_secret: `pi_mock_${Date.now()}_secret_placeholder`,
        amount: Math.round(amount * 100), // Convert to cents
        currency,
        status: 'requires_payment_method',
      };

      // Simulate network delay
      await new Promise(resolve => setTimeout(resolve, 800));
      
      return paymentIntent;
    } catch (error) {
      console.error('Error creating payment intent:', error);
      throw this.handleStripeError(error);
    }
  }

  async confirmPayment(paymentIntentClientSecret: string, paymentMethodId: string): Promise<StripePaymentIntent> {
    try {
      await this.initialize();
      
      // Mock successful confirmation
      const paymentIntent: StripePaymentIntent = {
        id: paymentIntentClientSecret.split('_secret_')[0],
        client_secret: paymentIntentClientSecret,
        amount: 0, // Would be set properly in real implementation
        currency: 'usd',
        status: 'succeeded',
      };

      // Simulate processing time
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      return paymentIntent;
    } catch (error) {
      console.error('Error confirming payment:', error);
      throw this.handleStripeError(error);
    }
  }

  async listPaymentMethods(): Promise<StripePaymentMethod[]> {
    try {
      await this.initialize();
      
      // Mock data - would fetch from Stripe API
      const mockPaymentMethods: StripePaymentMethod[] = [
        {
          id: 'pm_mock_visa',
          type: 'card',
          card: {
            brand: 'visa',
            last4: '4242',
            exp_month: 12,
            exp_year: 2025,
          },
          created: Date.now() / 1000,
        },
        {
          id: 'pm_mock_mastercard',
          type: 'card',
          card: {
            brand: 'mastercard',
            last4: '5555',
            exp_month: 6,
            exp_year: 2026,
          },
          created: Date.now() / 1000 - 86400,
        },
      ];

      // Simulate network delay
      await new Promise(resolve => setTimeout(resolve, 500));
      
      return mockPaymentMethods;
    } catch (error) {
      console.error('Error fetching payment methods:', error);
      throw this.handleStripeError(error);
    }
  }

  async detachPaymentMethod(paymentMethodId: string): Promise<void> {
    try {
      await this.initialize();
      
      // Mock implementation
      console.log(`Detaching payment method: ${paymentMethodId}`);
      
      // Simulate network delay
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error('Error detaching payment method:', error);
      throw this.handleStripeError(error);
    }
  }

  private detectCardBrand(cardNumber: string): string {
    const cleanNumber = cardNumber.replace(/\s/g, '');
    
    if (cleanNumber.startsWith('4')) return 'visa';
    if (cleanNumber.startsWith('5') || cleanNumber.startsWith('2')) return 'mastercard';
    if (cleanNumber.startsWith('3')) return 'amex';
    if (cleanNumber.startsWith('6')) return 'discover';
    
    return 'unknown';
  }

  private handleStripeError(error: any): Error {
    if (error?.type === 'StripeCardError') {
      return new Error(error.message || 'Card error occurred');
    }
    
    if (error?.type === 'StripeValidationError') {
      return new Error('Invalid payment information provided');
    }
    
    if (error?.type === 'StripeAPIError') {
      return new Error('Payment service temporarily unavailable');
    }
    
    return new Error('Payment processing failed. Please try again.');
  }

  // Utility method to format card display
  formatCardDisplay(paymentMethod: StripePaymentMethod): string {
    const brand = paymentMethod.card.brand.toUpperCase();
    const last4 = paymentMethod.card.last4;
    return `${brand} •••• •••• •••• ${last4}`;
  }

  // Utility method to validate card number (basic Luhn algorithm)
  validateCardNumber(cardNumber: string): boolean {
    const cleanNumber = cardNumber.replace(/\s/g, '');
    
    if (cleanNumber.length < 13 || cleanNumber.length > 19) {
      return false;
    }
    
    let sum = 0;
    let shouldDouble = false;
    
    for (let i = cleanNumber.length - 1; i >= 0; i--) {
      let digit = parseInt(cleanNumber.charAt(i));
      
      if (shouldDouble) {
        digit *= 2;
        if (digit > 9) {
          digit -= 9;
        }
      }
      
      sum += digit;
      shouldDouble = !shouldDouble;
    }
    
    return sum % 10 === 0;
  }
}

// Export singleton instance
export const stripeService = new StripeService();