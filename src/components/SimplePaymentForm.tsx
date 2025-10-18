import React, { useState } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { CreditCard, Lock } from 'lucide-react';

type SimplePaymentFormProps = {
  amount: number;
  onPaymentSubmit: (paymentData: {
    cardNumber: string;
    expiryMonth: string;
    expiryYear: string;
    cvc: string;
    nameOnCard: string;
    email: string;
  }) => void;
  loading: boolean;
  onCancel: () => void;
};

export function SimplePaymentForm({ amount, onPaymentSubmit, loading, onCancel }: SimplePaymentFormProps) {
  const [cardNumber, setCardNumber] = useState('');
  const [expiryMonth, setExpiryMonth] = useState('');
  const [expiryYear, setExpiryYear] = useState('');
  const [cvc, setCvc] = useState('');
  const [nameOnCard, setNameOnCard] = useState('');
  const [email, setEmail] = useState('');

  const formatCardNumber = (value: string) => {
    // Remove all non-digits
    const digits = value.replace(/\D/g, '');
    // Add spaces every 4 digits
    const formatted = digits.replace(/(\d{4})(?=\d)/g, '$1 ');
    return formatted.slice(0, 19); // Max length with spaces
  };

  const handleCardNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCardNumber(e.target.value);
    setCardNumber(formatted);
  };

  const handleExpiryMonthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 2);
    if (parseInt(value) > 12) return;
    setExpiryMonth(value);
  };

  const handleExpiryYearChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 4);
    setExpiryYear(value);
  };

  const handleCvcChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 4);
    setCvc(value);
  };

  const isFormValid = () => {
    const cardDigits = cardNumber.replace(/\s/g, '');
    return (
      cardDigits.length >= 13 && // Minimum card length
      expiryMonth.length === 2 &&
      expiryYear.length === 4 &&
      cvc.length >= 3 &&
      nameOnCard.trim().length > 0 &&
      email.includes('@') &&
      parseInt(expiryMonth) >= 1 && parseInt(expiryMonth) <= 12 &&
      parseInt(expiryYear) >= new Date().getFullYear()
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid() || loading) return;

    onPaymentSubmit({
      cardNumber: cardNumber.replace(/\s/g, ''),
      expiryMonth,
      expiryYear,
      cvc,
      nameOnCard: nameOnCard.trim(),
      email: email.trim()
    });
  };

  return (
    <Card className="bg-[#ffffff] border-[#a8b892]">
      <CardHeader className="bg-[#556B2F] text-[#f8f9f6]">
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="w-5 h-5" />
          Payment Details
        </CardTitle>
      </CardHeader>

      <CardContent className="p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Amount Summary */}
          <div className="bg-[#f8f9f6] rounded-lg p-4 mb-6">
            <div className="flex justify-between items-center">
              <span className="text-[#3c4f21] font-medium">Total Amount:</span>
              <span className="text-xl font-bold text-[#556B2F]">${amount.toFixed(2)}</span>
            </div>
          </div>

          {/* Card Number */}
          <div>
            <Label htmlFor="cardNumber">Card Number</Label>
            <Input
              id="cardNumber"
              type="text"
              placeholder="1234 5678 9012 3456"
              value={cardNumber}
              onChange={handleCardNumberChange}
              className="mt-1"
              required
            />
          </div>

          {/* Expiry and CVC */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="expiryMonth">Month</Label>
              <Input
                id="expiryMonth"
                type="text"
                placeholder="MM"
                value={expiryMonth}
                onChange={handleExpiryMonthChange}
                className="mt-1"
                required
              />
            </div>
            <div>
              <Label htmlFor="expiryYear">Year</Label>
              <Input
                id="expiryYear"
                type="text"
                placeholder="YYYY"
                value={expiryYear}
                onChange={handleExpiryYearChange}
                className="mt-1"
                required
              />
            </div>
            <div>
              <Label htmlFor="cvc">CVC</Label>
              <Input
                id="cvc"
                type="text"
                placeholder="123"
                value={cvc}
                onChange={handleCvcChange}
                className="mt-1"
                required
              />
            </div>
          </div>

          {/* Name on Card */}
          <div>
            <Label htmlFor="nameOnCard">Name on Card</Label>
            <Input
              id="nameOnCard"
              type="text"
              placeholder="John Doe"
              value={nameOnCard}
              onChange={(e) => setNameOnCard(e.target.value)}
              className="mt-1"
              required
            />
          </div>

          {/* Email */}
          <div>
            <Label htmlFor="email">Email Address</Label>
            <Input
              id="email"
              type="email"
              placeholder="john@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1"
              required
            />
            <p className="text-xs text-[#556B2F] mt-1">
              We'll send your booking confirmation to this email
            </p>
          </div>

          {/* Security Notice */}
          <div className="flex items-center gap-2 text-sm text-[#556B2F] bg-[#e8f5e8] p-3 rounded-lg">
            <Lock className="w-4 h-4 flex-shrink-0" />
            <span>Your payment information is secure and encrypted</span>
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={loading}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!isFormValid() || loading}
              className="flex-1 bg-[#c54a2c] hover:bg-[#b8432a] text-[#f8f9f6]"
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Processing...
                </div>
              ) : (
                `Pay $${amount.toFixed(2)}`
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}