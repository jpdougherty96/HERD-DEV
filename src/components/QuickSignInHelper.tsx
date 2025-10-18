import React, { useState } from 'react';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Zap, AlertTriangle, CheckCircle } from 'lucide-react';
import { supabase } from '../utils/supabase/client';

type QuickSignInHelperProps = {
  onAuthSuccess: () => void;
};

export function QuickSignInHelper({ onAuthSuccess }: QuickSignInHelperProps) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>('info');

  // Safe development mode check
  const isDevelopment = typeof import.meta !== 'undefined' && 
                       import.meta.env && 
                       import.meta.env.DEV === true;

  const showMessage = (text: string, type: 'success' | 'error' | 'info') => {
    setMessage(text);
    setMessageType(type);
    setTimeout(() => setMessage(''), 5000);
  };

  const handleQuickAuth = async () => {
    setLoading(true);
    
    try {
      // Test credentials that are likely to work
      const testAccounts = [
        { email: 'test@herdapp.com', password: 'TestPassword123!' },
        { email: 'dev@herdapp.com', password: 'DevPassword123!' },
        { email: 'demo@herdapp.com', password: 'DemoPassword123!' }
      ];

      console.log('🚀 Attempting quick authentication...');

      // Try signing in with existing test accounts first
      for (const account of testAccounts) {
        try {
          console.log(`🚀 Trying to sign in with ${account.email}...`);
          
          const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
            email: account.email,
            password: account.password,
          });

          if (signInData?.user && signInData?.session) {
            console.log(`✅ Successfully signed in with ${account.email}`);
            showMessage(`Successfully signed in with ${account.email}!`, 'success');
            onAuthSuccess();
            return;
          }
        } catch (signInError) {
          console.log(`❌ Sign in FAILED for ${account.email}, trying next...`);
        }
      }

      // If no existing accounts work, create a new one
      console.log('🚀 No existing accounts worked, creating new test account...');
      const newAccount = {
        email: `test-${Date.now()}@herdapp.com`,
        password: 'TestPassword123!'
      };

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: newAccount.email,
        password: newAccount.password,
        options: {
          data: { full_name: 'Test User' },
          emailRedirectTo: `${window.location.origin}?verified=true`
        }
      });

      if (signUpError) {
        throw signUpError;
      }

      if (signUpData?.user) {
        if (signUpData.session) {
          // Account created and automatically signed in
          console.log('✅ Test account created and signed in automatically');
          showMessage('Test account created and signed in successfully!', 'success');
          onAuthSuccess();
        } else {
          // Account created but needs email verification
          console.log('📧 Test account created, email verification may be required');
          showMessage('Test account created! If email verification is enabled, please check the console or try the DevAuthHelper below.', 'info');
          
          // Try to auto-confirm in development
          if (isDevelopment) {
            console.log('🔧 Attempting to auto-confirm in development mode...');
            // The user can use the DevAuthHelper to confirm
            showMessage('Account created! Use the Development Authentication Helper below to bypass email verification.', 'info');
          }
        }
      }

    } catch (error: any) {
      console.error('🚀 Quick auth error:', error);
      
      let errorMessage = 'Authentication FAILED. ';
      
      if (error.message?.includes('Invalid login credentials')) {
        errorMessage += 'Try using the Development Authentication Helper below, or check if email verification is required.';
      } else if (error.message?.includes('already registered')) {
        errorMessage += 'Account already exists but sign-in FAILED. Try the Development Authentication Helper.';
      } else {
        errorMessage += `Error: ${error.message}`;
      }
      
      showMessage(errorMessage, 'error');
    } finally {
      setLoading(false);
    }
  };

  if (!isDevelopment) {
    return null;
  }

  return (
    <Card className="mx-4 mt-4 bg-green-50 border-green-200">
      <div className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-5 h-5 text-green-600" />
          <h3 className="text-green-900 font-medium">Quick Sign In Helper</h3>
        </div>

        <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-600 mt-0.5" />
            <div className="text-yellow-800 text-sm">
              <p className="font-medium mb-1">One-Click Authentication</p>
              <p>This will try to sign in with existing test accounts or create a new one automatically.</p>
            </div>
          </div>
        </div>

        {message && (
          <div className={`p-3 rounded mb-4 flex items-start gap-2 ${
            messageType === 'success' ? 'bg-green-100 border border-green-200' :
            messageType === 'error' ? 'bg-red-100 border border-red-200' :
            'bg-blue-100 border border-blue-200'
          }`}>
            {messageType === 'success' && <CheckCircle className="w-4 h-4 text-green-600 mt-0.5" />}
            {messageType === 'error' && <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5" />}
            {messageType === 'info' && <AlertTriangle className="w-4 h-4 text-blue-600 mt-0.5" />}
            <div className={`text-sm ${
              messageType === 'success' ? 'text-green-800' :
              messageType === 'error' ? 'text-red-800' :
              'text-blue-800'
            }`}>
              {message}
            </div>
          </div>
        )}

        <Button
          onClick={handleQuickAuth}
          disabled={loading}
          className="w-full bg-green-600 hover:bg-green-700 text-white"
        >
          {loading ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              Authenticating...
            </>
          ) : (
            <>
              <Zap className="w-4 h-4 mr-2" />
              🚀 One-Click Sign In
            </>
          )}
        </Button>

        <p className="text-xs text-green-700 mt-2 text-center">
          Tries existing test accounts first, creates new one if needed
        </p>
      </div>
    </Card>
  );
}