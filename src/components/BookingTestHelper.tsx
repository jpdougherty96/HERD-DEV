import React, { useState } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import type { Class } from '../App';

type BookingTestHelperProps = {
  classes: Class[];
};

export function BookingTestHelper({ classes }: BookingTestHelperProps) {
  const [testResult, setTestResult] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const testBookingEndpoint = async () => {
    setLoading(true);
    setTestResult('Testing booking endpoint...');

    setTestResult(`Legacy booking function has been retired. Use the standard booking flow to test instead. Local classes loaded: ${classes.length}.`);
    setLoading(false);
  };

  return (
    <Card className="max-w-md mx-auto m-4">
      <CardHeader>
        <CardTitle className="text-lg">Booking System Test</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button 
          onClick={testBookingEndpoint}
          disabled={loading}
          className="w-full"
        >
          {loading ? 'Testing...' : 'Test Booking Endpoint'}
        </Button>
        
        {testResult && (
          <div className="bg-gray-100 rounded p-3 text-sm">
            <pre className="whitespace-pre-wrap">{testResult}</pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
